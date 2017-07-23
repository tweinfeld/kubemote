# Kubemote

A compact Kubernetes API library

# Installation

```npm install git://git@github.com:codefresh-io/kubemote.git```

# Usage

```javascript
let remote = new Kubemote(configuration);
```

If `configuration` is omitted, Kubemote will try to use user's `.kube` files:

```javascript
let remote = new Kubemote();
```

Manual configuration should include the fields `remote`, `host`, `port`, `certificate_authority`, `client_key`, and `client_certificate` i.e.:

```javascript
let remote = new Kubemote({
	host: "api.mykube.com",
    port: 8001,
    certificate_authority: [Buffer],
    client_key: [Buffer],
    client_certificate: [Buffer]
});
```