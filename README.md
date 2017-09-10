# Kubemote

A compact Kubernetes API library

# Installation

```npm install git://git@github.com:codefresh-io/kubemote.git```

# Usage

```javascript
let remote = new Kubemote();
```

Will search for a config file using KUBECONFIG environment variable, then in the user's home folder. The context will be derived from its "current-context".

```javascript
let remote = new Kubemote(Kubemote.CONFIGURATION_FILE({ context: "my-context" }));
```

Will search the file in the same manner as before, but will use "my-context" as the selected context.

```javascript
let remote = new Kubemote({
    host: "api.mykube.com",
    port: 8001,
    certificate_authority: [Buffer],
    client_key: [Buffer],
    client_certificate: [Buffer]
});
```

Will connect according to the manual configuration specified.

The full list of configuration options are:

`host` `port` `protocol` `certificate_authority` `client_key` `client_certificate` `username` `password` `insecure_tls` `namespace`  