import {Canister, text, nat64, update, Principal, Record, StableBTreeMap, ic, Result, Vec, init, query, Variant, nat8, Void} from "azle";

const DomainPayload = Record({
    name: text,
    extension: text,
    duration: nat64,
});

const ReserveDomainPayload = Record({
    name: text,
    extension: text,
    wallet: Principal,
});

const Domain = Record({
    id: text,
    owner: Principal,
    validUntil: nat64,
    updatedAt: nat64,
});
type Domain = typeof Domain.tsType;

const History = Record({
    owner: Principal,
    validUntil: nat64,
    createdAt: nat64,
});
type History = typeof History.tsType;


const Error = Variant({
    CallerNotCanisterOwner: Principal,
    CallerNotDomainOwner: Principal,
    DomainNotFound: text,
    DomainStillValid: Principal,
    DomainAlreadyClaimed: Principal,
    DomainOwnershipExpired: Principal,
    InvalidDuration: nat64,
    InvalidDomainNameLength: nat8,
    InvalidDomainExtension: text,
    DomainReserved: Principal,
    UnknownError: text,
});

const SUPPORTED_EXTENSIONS: text[] = ["icp", "ic", "moon"]; // Extensions that are supported by the service
const MIN_DOMAIN_NAME_LENGTH: nat8 = 3; // Minimum length of the domain name
const MAX_DOMAIN_NAME_LENGTH: nat8 = 40; // Maximum length of the domain name
const MIN_DURATION: nat64 = 1_000_000n; // 1 second in nanoseconds
const MAX_DURATION: nat64 = 31_536_000_000_000_000n; // 1 year in nanoseconds

let owner: Principal; // Owner of the canister

const domainsStorage = StableBTreeMap<text,Domain>(0);
const domainHistoryStorage = StableBTreeMap<text,Vec<History>>(1);
const reservedDomainsStorage = StableBTreeMap<text,Principal>(2);


export default Canister({
    init: init([], () => {
        owner = ic.caller();
    }),

    /**
     * Reserves a domain for a specific wallet.
     * Callable only by the owner of the canister.
     * @param payload Payload with a data required to reserve a domain
     * @returns The reserved domain
     */
    reserve: update([ReserveDomainPayload], Result(text, Error), (payload) => {
        // If caller is not the owner of the canister, he cannot reserve a domain
        if (owner.toText() !== ic.caller().toText()) {
            return Result.Err({ CallerNotCanisterOwner: ic.caller() });
        }

        // If domain name is not in the correct length range, revert
        if (payload.name.length < MIN_DOMAIN_NAME_LENGTH || payload.name.length > MAX_DOMAIN_NAME_LENGTH) {
            return Result.Err({ InvalidDomainNameLength: payload.name.length });
        }
        
        // If domain extension is not known, revert
        if (!SUPPORTED_EXTENSIONS.includes(payload.extension)) {
            return Result.Err({ InvalidDomainExtension: payload.extension });
        }

        const domainKey = getDomainKey(payload.name, payload.extension);
        // If domain is already claimed, it cannot be reserved
        if (domainsStorage.containsKey(domainKey)) {
            const domain = domainsStorage.get(domainKey);
            if (domain.Some) {
                return Result.Err({ DomainAlreadyClaimed: domain.Some.owner });
            }
        }

        // Set the domain as reserved for a specific wallet
        reservedDomainsStorage.insert(domainKey, payload.wallet);
        return Result.Ok(domainKey);
    }),

    /**
     * Claims a domain.
     * Callable by anyone.
     * @param payload Domain payload
     * @returns The claimed domain
     */
    claim: update([DomainPayload], Result(text, Error), (payload) => {
        try {
            // If domain duration is not in the correct range, revert
            if (payload.duration < MIN_DURATION || payload.duration > MAX_DURATION) {
                return Result.Err({ InvalidDuration: payload.duration }); 
            }

            // If domain name is not in the correct length range, revert
            if (payload.name.length < MIN_DOMAIN_NAME_LENGTH || payload.name.length > MAX_DOMAIN_NAME_LENGTH) {
                return Result.Err({ InvalidDomainNameLength: payload.name.length });
            }
            
            // If domain extension is not known, revert
            if (!SUPPORTED_EXTENSIONS.includes(payload.extension)) {
                return Result.Err({ InvalidDomainExtension: payload.extension });
            }

            // Assemble domain key
            const domainKey = getDomainKey(payload.name, payload.extension);
            // In case domain is already registered
            if (domainsStorage.containsKey(domainKey)) {
                const domain = domainsStorage.get(domainKey);
                // If domain ownership has not expired yet, revert
                // Else allow the claim of the domain
                if (domain.Some && domain.Some.validUntil >= ic.time()) {
                    return Result.Err({ DomainAlreadyClaimed: domain.Some.owner });
                }
            }

            // In case domain is reserved
            if (reservedDomainsStorage.containsKey(domainKey)) {
                const principal = reservedDomainsStorage.get(domainKey);
                // If domain is reserved for another wallet, revert
                if (principal.Some && principal.Some.toText() !== ic.caller().toText()) {
                    return Result.Err({ DomainReserved: principal.Some });
                }
                // If domain is reserved for the caller, remove the reservation
                reservedDomainsStorage.remove(domainKey);
            }
            
            // Create new domain
            const newDomain = {
                id: domainKey,
                owner: ic.caller(),
                validUntil: ic.time() + payload.duration,
                updatedAt: ic.time(),
            };

            // Update domain history
            updateHistoryRecord(domainKey, ic.caller(), newDomain.validUntil);
            // Add domain
            domainsStorage.insert(domainKey, newDomain);
            return Result.Ok(domainKey);
        } catch (err: any) {
            return Result.Err({ UnknownError: err });
        }
    }),

    /**
     * Rewokes the ownership of a domain.
     * Callable by anyone.
     * @param domainKey Domain to revoke
     * @returns The revoked domain
     */
    revoke: update([text], Result(text, Error), (domainKey) => {
        const domain = domainsStorage.get(domainKey);
        if (domain.Some) {
            // If caller is the owner of domain, he can revoke at any time, regardless of the expiration date
            if (domain.Some.owner.toText() !== ic.caller().toText()) {
                // In case caller is not the owner of the domain, he can revoke only if the domain has expired
                if (domain.Some.validUntil > ic.time()) {
                    return Result.Err({ DomainStillValid: domain.Some.owner });
                }
            }

          
            // Create new domain with a new owner
            const newDomain = {
                id: domainKey,
                owner: domain.Some.owner,
                validUntil: 0n,
                updatedAt: ic.time(),
            };
            
            // Update domain history
            updateHistoryRecord(domainKey, ic.caller(), newDomain.validUntil);
            // Add domain
            domainsStorage.insert(domainKey, newDomain);
            return Result.Ok(domainKey);
        } else {
            return Result.Err({ DomainNotFound: domainKey });
        }
    }),

    /**
     * Transfers the ownership over domain
     * Callable only by the owner of the domain.
     * @param domainKey Domain to transfer
     * @param newOwner New owner of the domain
     * @return The transferred domain
     */
    transfer: update([text, Principal], Result(text, Error), (domainKey, newOwner) => {
        const domain = domainsStorage.get(domainKey);
        if (domain.Some) {
            // If caller is not the owner of the domain, revert
            if (domain.Some.owner.toText() !== ic.caller().toText()) {
                return Result.Err({ CallerNotDomainOwner: ic.caller() })
            }

            if (domain.Some.validUntil < ic.time()) {
                return Result.Err({ DomainOwnershipExpired: domain.Some.owner });
            }

            // Create new domain with a new owner
            const newDomain = {
                id: domainKey,
                owner: newOwner,
                validUntil: domain.Some.validUntil,
                updatedAt: ic.time(),
            };
            // Update domain history
            updateHistoryRecord(domainKey, newOwner, newDomain.validUntil);
            // Add domain
            domainsStorage.insert(domainKey, newDomain);
            return Result.Ok(domainKey);
        } else {
            return Result.Err({ DomainNotFound: domainKey });
        }
    }),

    /**
     * Returns the domain data.
     * @param domainKey Domain to get
     * @returns The domain data
     */
    getDomain: query([text], Result(Domain, Error), (domainKey) => {
        const domain = domainsStorage.get(domainKey);
        if (domain.Some) {
            return Result.Ok(domain.Some);
        } else {
            return Result.Err({ DomainNotFound: domainKey });
        }
    }),

    /**
     * Returns the domain history.
     * @param domainKey Domain to get
     * @returns The domain history
     */
    getDomainHistory: query([text], Result(Vec(History), Error), (domainKey) => {
        const domainHistory = domainHistoryStorage.get(domainKey);
        if (domainHistory.Some) {
            return Result.Ok(domainHistory.Some);
        } else {
            return Result.Err({ DomainNotFound: domainKey });
        }
    }),

    /**
     * Returns the owner of a domain.
     * @param domainKey Domain to get
     * @returns The domain owner
     */
    lookup: query([text], Result(Principal, Error), (domainKey) => {
        const domain = domainsStorage.get(domainKey);
        if (domain.Some) {
            return Result.Ok(domain.Some.owner);
        } else {
            return Result.Err({ DomainNotFound: domainKey });
        }
    }),

    /**
     * Returns the domain key for a specific user.
     * @param user User to get the domains for
     * @returns The domain keys owned by the user
     */
    reverseLookup: query([Principal], Result(Vec(text), text), (user) => {
        const domains = domainsStorage.values();
        const userDomains = domains.filter((domain) => {
            return domain.owner === user;
        });

        return Result.Ok(userDomains.map((domain) => {
            return domain.id;
        }));
    }),

    /**
     * Returns the owner of the canister.
     * @returns The canister owner
     */
    getCanisterOwner: query([], Principal, () => {
        return owner;
    }),

    getCaller: query([], Principal, () => {
        return ic.caller();
    }),
});


// Helper functions

/**
 * Returns the domain key for a specific domain name and extension.
 * @param name Domain name
 * @param extension Domain extension
 * @returns The domain key
 */
function getDomainKey(name: text, extension: text): text {
    return `${name}.${extension}`;
}

/**
 * Updates the domain history.
 * @param domainKey Domain to update
 * @param owner Owner of the domain
 * @param validUntil Timestamp until the domain is valid
 */
function updateHistoryRecord(domainKey: text, owner: Principal, validUntil: nat64): Void {
    // Create new history record
    const historyRecord = {
        owner: owner,
        validUntil: validUntil,
        createdAt: ic.time(),
    };
    
    // Get old history
    const oldHistory = domainHistoryStorage.get(domainKey);
    let newHistory: Vec<History>;
    if (oldHistory.Some) {
        // If there is already a history, append the new record
        newHistory = [...oldHistory.Some, historyRecord];
    } else {
        // Else create a new history with a new record entry
        newHistory = [historyRecord];
    }

    // Update history
    domainHistoryStorage.insert(domainKey, newHistory);
}