const
    _ = require('lodash'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    kefir = require('kefir'),
    https = require('https'),
    concatStream = require('concat-stream'),
    splitStream = require('split'),
    querystring = require('querystring'),
    yaml = require('js-yaml'),
    EventEmitter = require('events').EventEmitter;

const
    API_MAJOR_VERSION = 1,
    REQUEST = Symbol('Request'),
    API_NAMESPACE = {
        base: (namespace)=> `/api/v${API_MAJOR_VERSION.toString()}/namespaces/${namespace}`,
        infrastructure: ()=> `/api/v${API_MAJOR_VERSION.toString()}`,
        batch: (namespace, watch = false)=> `/apis/batch/v${API_MAJOR_VERSION.toString()}/${ watch ? "watch/": "" }namespaces/${namespace}`
    };

const
    serializeSelectorQuery = (query)=> _.map(query, (v, k)=>[k, v].join('=')).join(','),
    requestFactory = function(baseConfig){
        return function({
            method = "GET",
            path = "/",
            qs = {},
            headers = {},
            api_namespace = "base",
            namespace = "default",
            watch = false
        }){
            return https.request(_.assign(baseConfig, {
                headers,
                method,
                path: [`${API_NAMESPACE[api_namespace](namespace, watch)}/${_(path).split('/').compact().join('/')}`, querystring.stringify(qs)].join('?')
            }));
        };
    };

const endRequestBufferResponse = (request, content)=> {
    request.end(content);
    return kefir
        .fromEvents(request, 'response')
        .merge(kefir.fromEvents(request, 'error').flatMap(kefir.constantError))
        .take(1)
        .takeErrors(1)
        .takeUntilBy(kefir.fromEvents(request, 'end').take(1))
        .flatMap((res)=>{
            return kefir
                .fromCallback((cb)=> res.pipe(concatStream({ encoding: "string" }, cb)))
                .flatMap(~~(res.statusCode / 100) === 2 ? kefir.constant : kefir.constantError);
        });
};

module.exports = class Kubemote extends EventEmitter {

    constructor(config){
        super();
        this[REQUEST] = requestFactory(config ? Kubemote.manualConfigResolver(config) : Kubemote.homeDirConfigResolver());
    }

    static manualConfigResolver({ host, port, certificate_authority, client_key, client_certificate }){
        return {
            host,
            port,
            ca: certificate_authority,
            cert: client_certificate,
            key: client_key
        };
    }

    static homeDirConfigResolver({ clusterName, userName } = {}){
        const findByName = (name)=> _.partial(_.find, _, { name });
        let
            { clusters, users, apiVersion } = _.flow(
                _.partial(path.resolve, _, '.kube', 'config'),
                _.partial(fs.readFileSync, _, { encoding: "utf8" }),
                yaml.safeLoad
            )(os.homedir()),
            cluster = (clusterName ? findByName(clusterName) : _.first)(clusters),
            user = (userName ? findByName(userName) : _.first)(users);

        if((apiVersion.match(/v([0-9]+)/)||[]).slice(1).map(Number).pop() !== API_MAJOR_VERSION) throw(new Error('Unsupported api version'));

        return _.assign(
            _.zipObject(["host", "port"], _.get(cluster, 'cluster.server', '').match(/https?:\/\/([^:]+):([0-9]+)/).slice(1)),
            _.zipObject(["ca", "cert", "key"] , [].concat(
                _.at(cluster, ["cluster.certificate-authority"]),
                _.at(user, ["user.client-certificate", "user.client-key"])
            ).map(_.unary(fs.readFileSync)))
        );
    }

    getServices(selector){
        let request = this[REQUEST]({ path: "/services", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request)
            .map(JSON.parse)
            .toPromise();
    }

    getPods(selector){
        let request = this[REQUEST]({ path: "/pods", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request)
            .map(JSON.parse)
            .toPromise();
    }

    getPodLogs({ podName }){
        let request = this[REQUEST]({ path: `/pods/${podName}/log` });
        return endRequestBufferResponse(request).toPromise();
    }

    createJob(jobSpecJson){
        let byteSpec = Buffer.from(JSON.stringify(jobSpecJson), 'utf8');
        let request = this[REQUEST]({ method: "POST", api_namespace: "batch", path: "/jobs", headers: { "Content-Type": "application/json", "Content-Length": byteSpec.length } });
        return endRequestBufferResponse(request, byteSpec)
            .map(JSON.parse)
            .toPromise();
    }

    watchJob({ jobName }){
        let request = this[REQUEST]({ method: "GET", watch: true, api_namespace: "batch", path: `/jobs/${jobName}` });
        let updateStream = kefir
            .fromEvents(request, 'response')
            .takeUntilBy(kefir.fromEvents(request, 'connect', (res, socket)=> socket).flatMap((socket)=> kefir.fromEvents(socket, 'end').take(1)))
            .flatMap((response)=> kefir.fromEvents(response.pipe(splitStream()), 'data'))
            .map(JSON.parse);

        request.end();
        updateStream.onValue((payload)=> this.emit('watch', payload));
        return updateStream.take(1).takeErrors(1).toPromise();
    }

    deleteJob({ jobName }){
        let request = this[REQUEST]({ method: "DELETE", api_namespace: "batch", path: `/jobs/${jobName}` });
        return endRequestBufferResponse(request).map(JSON.parse).toPromise();
    }

    getNodes(){
        let request = this[REQUEST]({ method: "GET", api_namespace: "infrastructure", path: `/nodes` });
        return endRequestBufferResponse(request).map(JSON.parse).toPromise();
    }
};