# Kubemote

A compact Kubernetes API library

# Installation

```npm install git://git@github.com:codefresh-io/kubemote.git```

# Usage

```javascript
let remote = new Kubemote([configuration]);
```

"Configuration" is comprised of:

  * `type` - Either `homeDir` or `manual`
  * `config` - The configuration, respective to the selected `type`

```javascript
let remote = new Kubemote({ type: "homeDir" });
```

"home_dir" configuration can contain a `context` field. When it's omitted, the default context will be used.

"manual" configuration must include the fields `remote`, `host`, `port`, `certificate_authority`, `client_key`, and `client_certificate` i.e.:

```javascript
let remote = new Kubemote({
    type: "manual",
    config: {
      host: "api.mykube.com",
      port: 8001,
      certificate_authority: [Buffer],
      client_key: [Buffer],
      client_certificate: [Buffer]
  }
});
```