const
    _ = require('lodash'),
    fs = require('fs'),
    os = require('os'),
    url = require('url'),
    path = require('path'),
    kefir = require('kefir'),
    https = require('https'),
    http = require('http'),
    concatStream = require('concat-stream'),
    splitStream = require('split'),
    querystring = require('querystring'),
    yaml = require('js-yaml'),
    { execSync } = require('child_process'),
    EventEmitter = require('events').EventEmitter;

const
    REQUEST = Symbol('Request'),
    RECONNECT_DELAY = 1 * 6000;

const
    assert = (val, message)=> val || (()=>{ throw(new Error(message)); })(),
    bufferToString = (buffer)=> buffer.toString('utf8'),
    serializeSelectorQuery = (query)=> _.map(query, (v, k)=>[k, v].join('=')).join(','),
    createRequestSendWatchEvents = function(options, content){
        let destroy = _.noop, currentSocket;
        let updateStream = kefir.repeat(()=> {
            let request = this[REQUEST](options);
            request.end(content);
            return kefir.concat([
                kefir
                    .fromEvents(request, 'response')
                    .merge(kefir.fromEvents(request, 'error').flatMap(kefir.constantError))
                    .flatMap((response)=> kefir.fromEvents(response.pipe(splitStream(null, null, { trailing: false })), 'data'))
                    .map(JSON.parse)
                    .takeUntilBy(
                        kefir
                            .fromEvents(request, 'socket')
                            .take(1)
                            .flatMap((socket)=> {
                                currentSocket = socket;
                                return kefir.merge(["close", "error"].map((eventName)=> kefir.fromEvents(socket, eventName))).take(1);
                            })
                    )
                    .takeErrors(1),
                kefir.later(RECONNECT_DELAY).ignoreValues()
            ]);
        }).takeUntilBy(kefir.fromCallback((cb)=> destroy = cb));

        updateStream.onValue((payload)=> this.emit('watch', payload));
        return ()=>{ destroy(); currentSocket && currentSocket.destroy(); }
    },
    endRequestBufferResponse = (request, content)=> {
        request.end(content);
        return kefir
            .fromEvents(request, 'response')
            .merge(kefir.fromEvents(request, 'error').flatMap(kefir.constantError))
            .take(1)
            .takeUntilBy(kefir.fromEvents(request, 'end').take(1))
            .flatMap((res)=>{
                return kefir
                    .fromCallback((cb)=> res.pipe(concatStream({ encoding: "buffer" }, cb)))
                    .map(contentTypes[res.headers["content-type"]] || bufferToString)
                    .flatMap(~~(res.statusCode / 100) === 2 ? kefir.constant : kefir.constantError);
            })
            .takeErrors(1);
    };

const contentTypes = {
    "application/json": _.flow(bufferToString, JSON.parse),
    "text/plain": bufferToString
};

module.exports = class Kubemote extends EventEmitter {

    constructor({
        host,
        port,
        protocol = "https",
        certificate_authority,
        client_key,
        client_certificate,
        username,
        password,
        token,
        insecure_tls = false,
        namespace = "default"
    } = Kubemote.CONFIGURATION_FILE()){

        super();

        const
            client = _.get({ http, https }, protocol, https),
            baseConfig = _.merge(
                { host, port },
                username && { headers: { "Authorization": ["basic", Buffer.from([username, assert(password, 'Password cannot be empty')].join(':'), 'utf8').toString('base64')].join(' ') } },
                insecure_tls && { rejectUnauthorized: !insecure_tls },
                certificate_authority && { ca: certificate_authority },
                client_key && { key: client_key },
                client_certificate && { cert: client_certificate },
                token && { headers: { "Authorization": ["Bearer", token].join(' ') } }
            );

        this[REQUEST] = function({
            method = "GET",
            path,
            qs = {},
            headers = {}
        }){
            return client.request(_.merge({}, baseConfig, {
                headers,
                method,
                path: _.compact([_.template(path)({ namespace }), querystring.stringify(qs)]).join('?')
            }));
        };
    }

    static IN_CLUSTER_CONFIGURATION({
        baseFolder = "/var/run/secrets/kubernetes.io/serviceaccount"
    } = {}){
        let [ token, certificate_authority, namespace ] = ["token", "ca.crt", "namespace"].map(_.flow(_.unary(_.partial(path.join, baseFolder)), fs.readFileSync));
        return {
            namespace: namespace.toString('utf8'),
            certificate_authority,
            token: token.toString('utf8'),
            host: "kubernetes"
        };
    }

    static CONFIGURATION_FILE({
        file = [ ...(process.env["KUBECONFIG"] || "").split(path.delimiter).map(_.trim), path.resolve(os.homedir(), '.kube', 'config') ].filter(Boolean).find(fs.existsSync),
        context: contextName,
        namespace
    } = {}){

        const CONFIGURATION_READERS = [
            { keys: ["cluster.certificate-authority-data"],  format: _.flow(([str])=> Buffer.from(str, 'base64'), (buffer)=> ({ certificate_authority: buffer })) },
            { keys: ["cluster.certificate-authority"], format: _.flow(([filename])=> fs.readFileSync(filename), (buffer)=> ({ certificate_authority: buffer })) },
            { keys: ["user.client-certificate"], format: _.flow(([filename])=> fs.readFileSync(filename), (buffer)=> ({ client_certificate: buffer })) },
            { keys: ["user.client-key"], format: _.flow(([filename])=> fs.readFileSync(filename), (buffer)=> ({ client_key: buffer })) },
            { keys: ["cluster.server"], format: _.flow(_.first, url.parse, ({ host, port, protocol })=> ({ protocol: _.first(protocol.match(/^https?/)), host: _.first(host.match(/[^:]+/)), port: (port || (protocol === "https:" ? 443 : 80)) })) },
            { keys: ["user.username", "user.password"], format: ([username, password])=>({ username, password }) },
            { keys: ["cluster.insecure-skip-tls-verify"], format: ([value])=> ({ insecure_tls: value }) },
            { keys: ["user.auth-provider.config.access-token"], format: ([token])=> ({ token }) },
            { keys: ["user.auth-provider.config.cmd-path", "user.auth-provider.config.cmd-args"], format: _.flow(_.partial(_.zipWith, _, [(str)=>`"${str}"`, _.identity], (v, f)=> f(v)), _.partial(_.join, _, ' '), _.partial(execSync, _, { encoding: "utf8" }), JSON.parse, _.partial(_.get, _, 'credential.access_token'), (token)=>({ token })) }
        ];

        let
            { users, clusters, contexts, ["current-context"]: defaultContext } = yaml.safeLoad(fs.readFileSync(file, 'utf8')),
            config = _(contexts)
                .chain()
                .groupBy('name')
                .mapValues((values)=>{
                    let { cluster: clusterName, user: userName } = _.get(values, '0.context');
                    return {
                        user: _.get(_.find(users, ({ name }) => userName === name), 'user'),
                        cluster: _.get(_.find(clusters, ({ name }) => clusterName === name), 'cluster')
                    };
                })
                .get(contextName || defaultContext)
                .value();

        assert(config, 'Configuration file context not found!');
        return CONFIGURATION_READERS.reduce((ac, { keys, format })=> _.assign(ac, keys.every((keyName)=> _.has(config, keyName)) && format(_.at(config, keys))), { namespace });
    }

    getNamespaces(){
        const request = this[REQUEST]({
            path: "/api/v1/namespaces",
            qs: {}
        });
        return endRequestBufferResponse(request).toPromise();
    }

    getServices(selector){
        const request = this[REQUEST]({
            path: "/api/v1/namespaces/${namespace}/services",
            qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) }
        });
        return endRequestBufferResponse(request).toPromise();
    }

    getPods(selector){
        const request = this[REQUEST]({
            path: "/api/v1/namespaces/${namespace}/pods",
            qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    getConfigMap({ name }){
        const request = this[REQUEST]({
            path: `/api/v1/namespaces/$\{namespace\}/configmaps/${name}`,
            //qs: { includeUninitialized: true, watch: false }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    getConfigMaps(selector){
        const request = this[REQUEST]({
            path: "/api/v1/namespaces/${namespace}/configmaps",
            qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    getReplicaSets(selector){
      // /apis/extensions/v1beta1/namespaces/{namespace}/replicasets/{name}
      const request = this[REQUEST]({
          path: "/apis/extensions/v1beta1/namespaces/$\{namespace\}/replicasets/",
          qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) }
      });

      return endRequestBufferResponse(request).toPromise();
    }

    getDeployments(selector){
        const request = this[REQUEST]({
            path: "/apis/apps/v1beta1/namespaces/$\{namespace\}/deployments",
            qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    patchDeployment({ name, spec }){
        let
            deploymentName = name || _.get(spec, 'metadata.name'),
            byteSpec = Buffer.from(JSON.stringify(spec), 'utf8');

        const request = this[REQUEST]({
            method: "PATCH",
            path: `/apis/apps/v1beta1/namespaces/$\{namespace\}/deployments/${deploymentName}`,
            headers: { "Content-Type": "application/strategic-merge-patch+json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    deleteDeployment({ name }){
        const request = this[REQUEST]({
            method: "DELETE",
            path: `/apis/apps/v1beta1/namespaces/$\{namespace\}/deployments/${name}`,
            headers: { "Accept": "application/json", "Content-Length": 0 }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    deleteConfigMap({ name }){
        const request = this[REQUEST]({
            method: "DELETE",
            path: `/api/v1/namespaces/$\{namespace\}/configmaps/${name}`,
            headers: { "Accept": "application/json", "Content-Length": 0 }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    getPodLogs({ podName }){
        const request = this[REQUEST]({
            path: `/api/v1/namespaces/$\{namespace\}/pods/${podName}/log`
        });

        return endRequestBufferResponse(request).toPromise();
    }

    createPod(podSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(podSpecJson), 'utf8');
        const request = this[REQUEST]({
            method: "POST",
            path: "/api/v1/namespaces/$\{namespace\}/pods",
            headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    createDeployment(deploymentSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(deploymentSpecJson), 'utf8');
        const request = this[REQUEST]({
            method: "POST",
            path: "/apis/apps/v1beta1/namespaces/${namespace}/deployments",
            headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    createJob(jobSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(jobSpecJson), 'utf8');
        const request = this[REQUEST]({
            method: "POST",
            path: "/apis/batch/v1/namespaces/${namespace}/jobs",
            headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    createConfigMap(configMapSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(configMapSpecJson), 'utf8');
        const request = this[REQUEST]({
            method: "POST",
            path: "/api/v1/namespaces/${namespace}/configmaps",
            headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    updateConfigMap(configMapSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(configMapSpecJson), 'utf8');
        const request = this[REQUEST]({
            method: "PUT",
            path: `/api/v1/namespaces/$\{namespace\}/configmaps/${_.get(configMapSpecJson, 'metadata.name')}`,
            headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length }
        });

        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    watchDeploymentList(selector){
        return Promise.resolve(createRequestSendWatchEvents.call(this, {
            method: "GET",
            path: "/apis/apps/v1beta1/watch/namespaces/$\{namespace\}/deployments",
            qs: { includeUninitialized: true, watch: true, labelSelector: serializeSelectorQuery(selector) }
        }));
    }

    watchPodList(selector){
        return Promise.resolve(createRequestSendWatchEvents.call(this, {
            method: "GET",
            path: "/api/v1/watch/namespaces/${namespace}/pods",
            qs: { includeUninitialized: true, watch: true, labelSelector: serializeSelectorQuery(selector) }
        }));
    }

    watchServiceList(selector){
        return Promise.resolve(createRequestSendWatchEvents.call(this, {
            method: "GET",
            path: "/api/v1/watch/namespaces/${namespace}/services",
            qs: { includeUninitialized: true, watch: true, labelSelector: serializeSelectorQuery(selector) }
        }));
    }

    watchJobList(selector){
        return Promise.resolve(createRequestSendWatchEvents.call(this, {
            method: "GET",
            path: "/apis/batch/v1/watch/namespaces/${namespace}/jobs",
            qs: { includeUninitialized: true, watch: true, labelSelector: serializeSelectorQuery(selector) }
        }));
    }

    watchJob({ jobName }){
        return Promise.resolve(createRequestSendWatchEvents.call(this, {
            method: "GET",
            path: `/apis/batch/v1/watch/namespaces/$\{namespace\}/jobs/${jobName}`,
            qs: { watch: true }
        }));
    }

    deleteJob({ jobName }){
        const request = this[REQUEST]({
            method: "DELETE",
            path: `/apis/batch/v1/namespaces/$\{namespace\}/jobs/${jobName}`,
            headers: { "Accept": "application/json", "Content-Length": 0 },
            qs: { gracePeriodSeconds: 0 }
        });

        return endRequestBufferResponse(request).toPromise();
    }

    getNodes(){
        let request = this[REQUEST]({
            method: "GET",
            path: "/api/v1/nodes"
        });

        return endRequestBufferResponse(request).toPromise();
    }
};
