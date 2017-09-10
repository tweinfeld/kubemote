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
    EventEmitter = require('events').EventEmitter;

const
    API_MAJOR_VERSION = 1,
    REQUEST = Symbol('Request');

const apiNamespaces = {
    base: (namespace)=> `/api/v${API_MAJOR_VERSION.toString()}/namespaces/${namespace}`,
    infrastructure: ()=> `/api/v${API_MAJOR_VERSION.toString()}`,
    batch: (namespace, watch = false)=> `/apis/batch/v${API_MAJOR_VERSION.toString()}/${ watch ? "watch/": "" }namespaces/${namespace}`
};

const contentTypes = {
    "application/json": _.flow(bufferToString, JSON.parse),
    "text/plain": bufferToString
};

const
    assert = (val, message)=> val || (()=>{ throw(new Error(message)); })(),
    bufferToString = (buffer)=> buffer.toString('utf8'),
    serializeSelectorQuery = (query)=> _.map(query, (v, k)=>[k, v].join('=')).join(','),
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
                client_certificate && { cert: client_certificate }
            );

        this[REQUEST] = function({
            method = "GET",
            path = "/",
            qs = {},
            headers = {},
            api_namespace = "base",
            watch = false
        }){
            return client.request(_.merge(baseConfig, {
                    headers,
                    method,
                    path: [`${apiNamespaces[api_namespace](namespace, watch)}/${_(path).split('/').compact().join('/')}`, querystring.stringify(qs)].join('?')
                })
            );
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
            { keys: ["cluster.insecure-skip-tls-verify"], format: ([value])=> ({ insecure_tls: value }) }
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
        return CONFIGURATION_READERS.reduce((ac, { keys, format })=> _.assign(ac, keys.every((keyName)=> _.has(config, keyName)) && format(_.at(config, keys))), {});
    }

    getServices(selector){
        let request = this[REQUEST]({ path: "/services", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request).toPromise();
    }

    getPods(selector){
        let request = this[REQUEST]({ path: "/pods", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request).toPromise();
    }

    getPodLogs({ podName }){
        let request = this[REQUEST]({ path: `/pods/${podName}/log` });
        return endRequestBufferResponse(request).toPromise();
    }

    createJob(jobSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(jobSpecJson), 'utf8');
        let request = this[REQUEST]({ method: "POST", api_namespace: "batch", path: "/jobs", headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length } });
        return endRequestBufferResponse(request, byteSpec).toPromise();
    }

    watchJob({ jobName }){
        let
            request = this[REQUEST]({ method: "GET", watch: true, api_namespace: "batch", path: `/jobs/${jobName}` }),
            destroy = _.noop;

        let updateStream = kefir
            .fromEvents(request, 'response')
            .flatMap((response)=> kefir.fromEvents(response.pipe(splitStream(null, null, { trailing: false })), 'data'))
            .map(JSON.parse)
            .takeUntilBy(kefir.fromEvents(request, 'socket').take(1).flatMap((socket)=> { destroy = _.once(()=> { socket.destroy(); }); return kefir.merge(["close", "error"].map((eventName)=> kefir.fromEvents(socket, eventName))).take(1); }));

        request.end();
        updateStream.onValue((payload)=> this.emit('watch', payload));
        return Promise.resolve(()=>{ destroy(); });
    }

    deleteJob({ jobName }){
        let request = this[REQUEST]({ method: "DELETE", api_namespace: "batch", path: `/jobs/${jobName}`, headers: { "Accept": "application/json", "Content-Length": 0 }, qs: { gracePeriodSeconds: 0 } });
        return endRequestBufferResponse(request).toPromise();
    }

    getNodes(){
        let request = this[REQUEST]({ method: "GET", api_namespace: "infrastructure", path: "/nodes" });
        return endRequestBufferResponse(request).toPromise();
    }
};