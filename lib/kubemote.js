const
    _ = require('lodash'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    kefir = require('kefir'),
    https = require('https'),
    util = require('util'),
    concatStream = require('concat-stream'),
    querystring = require('querystring'),
    yaml = require('js-yaml'),
    EventEmitter = require('events').EventEmitter;

const
    API_MAJOR_VERSION = 1,
    REQUEST = Symbol('Request');

const
    asDate = (str)=> new Date(str),
    formatItems = _.curry((mapper = _.identity, result)=> _.get(result, 'items', []).map(mapper), 2),
    jsonTemplate = (template)=> (source)=> _.reduce(template, (ac, v, k)=> {
        let [ sourceField, transformer = _.identity ] = _.flatten([v]);
        return _.set(ac, k, transformer(_.get(source, sourceField)));
    }, {}),
    serializeSelectorQuery = (query)=> _.map(query, (v, k)=>[k, v].join('=')).join(','),
    requestFactory = function(baseConfig){
        return function({
            namespace = "default",
            method = "GET",
            path = "/",
            qs = {}
        }){
            return https.request(_.assign(baseConfig, {
                method,
                path: [`/api/v${API_MAJOR_VERSION.toString()}/namespaces/${namespace}/${_(path).split('/').compact().join('/')}`, querystring.stringify(qs)].join('?')
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
        .flatMap((res)=> kefir.fromCallback((cb)=> res.pipe(concatStream({ encoding: "string" }, cb))))
        .map(JSON.parse)
};

module.exports = class Kubemote extends EventEmitter {

    constructor(config){
        super(); // TBD: Supply events for "watch=true" updates
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

    getServices(selector, namespace = "default"){
        let request = this[REQUEST]({ namespace, path: "/services", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request)
            .map(formatItems(jsonTemplate({
                "id": "metadata.uid",
                "name": "metadata.name",
                "create": ["metadata.creationTimestamp", asDate],
                "selector": "spec.selector",
                "port": ["spec.ports", jsonTemplate({
                    "name": "name",
                    "service_port": "port",
                    "container_port": "targetPort",
                    "protocol": "protocol"
                })]
            })))
            .toPromise();
    }

    getPods(selector, namespace = "default"){
        let request = this[REQUEST]({ namespace, path: "/pods", qs: { includeUninitialized: true, watch: false, labelSelector: serializeSelectorQuery(selector) } });
        return endRequestBufferResponse(request)
            .map(formatItems(jsonTemplate({
                "id": "metadata.uid",
                "name": "metadata.name",
                "create": ["metadata.creationTimestamp", asDate],
                "container": ["status.containerStatuses", (containers)=> containers.map(
                    jsonTemplate({
                        "id": ["containerID", (rawId)=> _.last((rawId || "").match(/docker:\/\/([a-f0-9]*)/i))],
                        "image": "image",
                        "name": "name",
                        "active": ["state", (obj)=> _.first(Object.keys(obj)) === "running"]
                    })
                )]
            })))
            .toPromise();
    }
};