# icp-name-service

ICP Name Service is a canister that contains the basic functionality of domain registration, transfer, revoking, history lookup, and reservation of the domain names. The canister has two roles defined with different access to the functionalities. It also implements a possibility like lookup using domain name and reverse lookup, available in existing naming services.

The following are the roles defined in the canister:

- owner - the owner of the canister
- user - the user of the canister, can be anyone

### Owner 

The sole purpose of the owner is to reserve the domains.


### User

User can register, transfer and revoke the domains. He can also see the history of the domain.

## Pre-requisites

- [Node.js](https://nodejs.org/en/download/) version 18
- [DFINITY Canister SDK](https://sdk.dfinity.org/docs/quickstart/local-quickstart.html) 1.9.0 - This can be installed using the commands mentioned in the following section. 

## Quickstart 

Make sure yu have Node v18 installed. In case you are using `nvm`, you can run:

```bash
nvm use
```

You are sure you done it correctly if you run and see a proper version:

```bash
node --version
```

In order to deploy the canister locally, we need `dfx`, which can be installed as a dependency of the project:

```bash
npm run dfx_install
``` 

Next, you want to start the local replica of ICP network:

```bash
npm run replica_start
```

The next step is to create identities for the owner and the user of the canister. You can do that by running:

```bash
npm run create_identities
```

Now you can deploy your canister locally. This will deploy canister using `owner` identity:

```bash
npm run canister_deploy_local
```

If you ever want to stop the replica:

```bash
npm run replica_stop
```


## Interacting with the canister

Most of the interaction can be done via Candid UI generated on canister deployment. It will use a random identity to interact with the canister. This is enough to test the functionality available for the user. Anyway, the interaction via `dfx` can be also used if there is a need to use `user` identity created on deployment.

As there is no way to change the identity used when interacting via Candid UI, the owner functionlities must be used via `dfx` cli. The following is an example of how to reserve a domain:

```bash
dfx canister call icpns reserve "(record { name = \"boleee\"; extension = \"icp\"; wallet = principal \"2ibo7-dia\" })" --identity owner
```