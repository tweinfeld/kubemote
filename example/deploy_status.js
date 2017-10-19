const
    _ = require('lodash'),
    util = require('util'),
    yargs = require('yargs'),
    kefir = require('kefir'),
    Table = require('cli-table'),
    Kubemote = require('../src/kubemote');

let cmdLineArgs = yargs
    .version(false)
    .usage("$0 --columns [[column identifiers]] --context [context] --deploy [deployment] --namespace [namespace] --format [json|table] --host [host] --port [port] --protocol [http|https]")
    .group(["deployment", "namespace"], 'Query Options:')
    .option('deployment', {
        type: "string",
        description: "Show one specific deployment name",
        alias: "deploy"
    })
    .option('namespace', {
        type: "string",
        description: "Query within a namespace",
        default:  "default",
        alias: "ns"
    })
    .group(["columns", "format"], 'Report Composition:')
    .option('columns', {
        alias: "col",
        type: "array",
        default: ["name", "desired", "current", "available", "age", "images", "pods"],
        description: "Columns to include in the report",
        choices: ["name", "desired", "current", "available", "age", "images", "pods", "selectors"],
        demandOption: "Please provide a list of required columns"
    })
    .option('format', {
        description: "Report type",
        choices: ["table", "json"],
        default: "table",
        type: "array",
        coerce: _.last
    })
    .group(["port", "host", "protocol", "context"], 'Connection:')
    .option('port', {
        type: "number",
        desc: "The port number to use when connecting",
        implies: ["host", "protocol"]
    })
    .option('host', {
        type: "string",
        desc: "The host name to use when connecting",
        implies: ["port", "protocol"]
    })
    .option('protocol', {
        type: "string",
        desc: "The protocol to use for connection",
        choices: ["http", "https"],
        implies: ["host", "port"]
    })
    .option('context', {
        type: "string",
        description: "Use a specific configuration context",
        alias: "ctx"
    })
    .argv;

const getDeployments = (
    client,
    deployment = "",
    includePods = false
)=> {
    return kefir
        .fromPromise(client.getDeployments())
        .flatMap((res)=> {
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deployment && _.matchesProperty('metadata.name', deployment)) || _.constant(true))
                    .map((deploymentDoc)=> {
                        return kefir.combine([
                            kefir.constant({ deploy: deploymentDoc }),
                            includePods ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs })=> ({ podDocs })) :
                                kefir.constant({})
                        ], _.merge);
                    })
            );
        })
        .takeErrors(1)
        .toPromise();
};

const getImageLabels = (function(){

    const
        SECOND = 1000,
        JOB_TIMEOUT = 30 * SECOND,
        POD_KEEP_ALIVE = 30 * SECOND;

    return (client, nodeName, imageName)=> {

        let
            id = _.range(10).map(_.partial(_.sample, "abcdefghijklmnopqrstuvwxyz0123456789".split(''))).join(''),
            destructionFunctions = [];

        return kefir.concat([
            kefir.fromPromise(client.createJob({
                "apiVersion": "batch/v1",
                "kind": "Job",
                "metadata": {
                    "name": id
                },
                "spec": {
                    "activeDeadlineSeconds": POD_KEEP_ALIVE,
                    "template": {
                        "metadata": {
                            "name": "probe"
                        },
                        "spec": {
                            "containers": [
                                {
                                    "command": ["/bin/sh"],
                                    "args": ["-c", `docker inspect ${imageName}`],
                                    "image": "docker:17.03",
                                    "env": [{
                                        "name": "DOCKER_API_VERSION",
                                        "value": "1.23"
                                    }],
                                    "imagePullPolicy": "IfNotPresent",
                                    "name": "probe",
                                    "resources": {},
                                    "volumeMounts": [
                                        {
                                            "mountPath": "/var/run",
                                            "name": "docker-sock"
                                        }
                                    ]
                                }
                            ],
                            nodeName,
                            "restartPolicy": "Never",
                            "volumes": [
                                {
                                    "name": "docker-sock",
                                    "hostPath": {
                                        "path": "/var/run"
                                    }
                                }
                            ]
                        }
                    }
                }
            })).ignoreValues(),
            kefir.fromPromise(client.watchJobList({ "job-name": id })).onValue((func)=> destructionFunctions.push(func)).ignoreValues(),
            kefir
                .fromEvents(client, 'watch')
                .filter(_.matches({object: {kind: "Job", metadata: {name: id}}}))
                .map(_.property('object'))
                .filter((jobDoc) => _.has(jobDoc, 'status.completionTime'))
                .merge(kefir.later(JOB_TIMEOUT).flatMap(() => kefir.constantError(new Error('Timed out waiting for K8 job to end'))))
                .take(1)
                .ignoreValues(),
            kefir.later().flatMap(()=> kefir
                .fromPromise(client.getPods({ "job-name": id }))
                .map(_.property('items.0.metadata.name'))
                .flatMap((podName)=> kefir.fromPromise(client.getPodLogs({podName})))
                .map(_.flow(JSON.parse, _.property('0.ContainerConfig.Labels')))
            )
        ])
        .takeErrors(1)
        .onEnd(()=>{
            destructionFunctions.forEach((func)=> func());
            client.deleteJob({ "jobName": id });
        })
        .toPromise();
    };
})();

const generateDeploymentsReport = function({
    context,
    namespace = "default",
    deployment = "",
    includePods = false,
    includeImages = false,
    host,
    port,
    protocol
}){
    let client;

    try {
        client = new Kubemote(_.defaults({ host, port, protocol }, Kubemote.CONFIGURATION_FILE({ namespace, context })));
    } catch(error){
        return Promise.reject(error);
    }

    return kefir
        .fromPromise(getDeployments(client, deployment, includePods || includeImages))
        .flatMap((deployments)=> {
            return kefir.combine([
                kefir.constant(deployments),
                includeImages ? kefir
                    .combine(
                        _(deployments)
                            .chain()
                            .map(({ podDocs })=> _(podDocs).map((podDoc)=> _.get(podDoc, 'spec.containers', []).map((container)=>({ image: container["image"], node: _.get(podDoc, 'spec.nodeName') }))).flatten().value())
                            .flatten()
                            .groupBy('image')
                            .mapValues(_.flow(_.sample, _.property('node')))
                            .map((nodeName, imageName)=> {
                                return kefir
                                    .fromPromise(getImageLabels(client, nodeName, imageName)).map((labels)=>({ [imageName]: labels }))
                                    .flatMapErrors(_.partial(kefir.constant, {}));
                            })
                            .value(),
                    _.merge) : kefir.constant({})
            ]);
        })
        .map(([report, images = {}])=>
            report.map((item)=> {
                let [name, replicas, updatedReplicas, unavailableReplicas, creationTimestamp, podDocs, labels] = _.zipWith(_.at(item, [
                    "deploy.metadata.name",
                    "deploy.status.replicas",
                    "deploy.status.updatedReplicas",
                    "deploy.status.unavailableReplicas",
                    "deploy.metadata.creationTimestamp",
                    "podDocs",
                    "deploy.metadata.labels"
                ]), [
                    _.identity,
                    _.toInteger,
                    _.toInteger,
                    _.toInteger,
                    Date.parse,
                    _.identity,
                    _.identity,
                ], (v, f) => f(v));

                return Object.assign({
                        name,
                        desired: replicas,
                        current: updatedReplicas,
                        available: replicas - unavailableReplicas,
                        age: Date.now() - creationTimestamp,
                        selectors: labels
                    },
                    includeImages && { images: _.pick(images, _(podDocs).map('spec.containers').flatten().map('image').value()) },
                    includePods && { pods: _(podDocs).map('metadata.name').value() }
                );
            })
        )
        .mapErrors(({ message = "Unspecified" } = {})=> message)
        .takeErrors(1)
        .toPromise();
};

const reportFormatters = {
    "json": (columns, rawReport)=> util.inspect(rawReport.map((row)=> _.pick(row, columns)), { depth: 10 }),
    "table": (function(){
            const timeSpanFormatter = (function(){
                const
                    MIL_IN_SEC = 1000,
                    MIL_IN_MIN = 60 * MIL_IN_SEC,
                    MIL_IN_HOUR = 60 * MIL_IN_MIN,
                    MIL_IN_DAY = 24 * MIL_IN_HOUR,
                    factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC],
                    captions = ["s", "m", "h", "d"];

                return (span)=>
                    _(factors)
                        .map((function(ac){
                            return (factor)=> {
                                let sectionValue = ~~(ac / factor);
                                ac = ac % factor;
                                return sectionValue;
                            }
                        })(span))
                        .dropWhile(_.negate(Boolean))
                        .reverse()
                        .map((v, index)=> [_.padStart(v, 2, '0'), captions[index]].join(''))
                        .reverse()
                        .join(':');
            })();

        const columnsFormats = {
            "name": { caption: "Name" },
            "desired": { caption: "Desired" },
            "current": { caption: "Current" },
            "available":  { caption: "Available" },
            "age": { caption: "Age", formatter: timeSpanFormatter },
            "images": { caption: "Images(s)", formatter: (images)=> _(images).map((labels, name)=> _.compact([name, !_.isEmpty(labels) && _.map(labels, (v,k)=>`  ${k}=${v}`).join('\n')]).join('\n')).join('\n') },
            "pods": { caption: "Pod(s)", formatter: (podNames)=> podNames.map((pod)=> _.truncate(pod, { length: 50 })).join('\n') },
            "selectors": { caption: "Selectors", formatter: (labels)=> _.truncate(_.map(labels, (v, k) => `${k}=${v}`).join('\n'), { length: 100 }) }
        };

        return function(columns, rawReport){
            let table = new Table({ head: columns.map((columnName)=> columnsFormats[columnName]["caption"]) });
            rawReport.forEach((row)=> table.push(columns.map((columnName)=> (columnsFormats[columnName].formatter || _.identity)(row[columnName]))));
            return table.toString();
        };
    })()
};

generateDeploymentsReport(
    Object.assign(
        _.pick(cmdLineArgs, ["namespace", "deployment", "context"]),
        { includePods: cmdLineArgs["col"].some((selectedColumn)=> ["pods"].includes(selectedColumn)) },
        { includeImages: cmdLineArgs["col"].some((selectedColumn)=> ["images"].includes(selectedColumn)) },
        _.at(cmdLineArgs, ["port", "host", "protocol"]).some(Boolean) && _.pick(cmdLineArgs, ["port", "host", "protocol"])
    ))
    .then(_.partial(reportFormatters[cmdLineArgs["format"]], _.uniq(["name", ...cmdLineArgs["col"]])))
    .then(console.log)
    .catch(console.warn);