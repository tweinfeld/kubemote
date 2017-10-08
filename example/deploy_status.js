const
    _ = require('lodash'),
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
        default: "default",
        alias: "ns"
    })
    .group(["columns", "format"], 'Report Composition:')
    .option('columns', {
        alias: "col",
        type: "array",
        default: ["name", "age", "desired", "current"],
        description: "Columns to include in the report",
        choices: ["name", "desired", "current", "available", "age", "images", "pods", "selectors"],
        demandOption: "Please provide a list of required columns"
    })
    .option('format', {
        description: "Report type",
        choices: ["table", "json"],
        default: "table",
        type: "string"
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

const generateDeploymentsReport = function({
    context,
    namespace = "default",
    deployment = "",
    extended = false,
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
        .fromPromise(client.getDeployments())
        .flatMap((res)=> {
            return kefir.combine(
                (res["kind"] === "Deployment" ? [res] : res["items"])
                    .filter((deployment && _.matchesProperty('metadata.name', deployment)) || _.constant(true))
                    .map((deploymentDoc)=> {
                        return kefir.combine([
                            kefir.constant({deploy: deploymentDoc}),
                            extended ?
                                kefir
                                    .fromPromise(client.getPods(_.get(deploymentDoc, 'spec.selector.matchLabels')))
                                    .map(({ items: podDocs }) => (
                                        {
                                            podNames: _(podDocs).map('metadata.name').value(),
                                            containers: _(podDocs).map('status.containerStatuses').flatten().value()
                                        }
                                    )) :
                                kefir.constant({})
                        ], _.merge);
                    })
            );
        })
        .map((report)=>
            report.map((item)=> {
                let [name, replicas, updatedReplicas, unavailableReplicas, creationTimestamp, containers, podNames, labels] = _.zipWith(_.at(item, [
                    "deploy.metadata.name",
                    "deploy.status.replicas",
                    "deploy.status.updatedReplicas",
                    "deploy.status.unavailableReplicas",
                    "deploy.metadata.creationTimestamp",
                    "containers",
                    "podNames",
                    "deploy.metadata.labels"
                ]), [
                    _.identity,
                    _.toInteger,
                    _.toInteger,
                    _.toInteger,
                    Date.parse,
                    _.identity,
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
                }, extended && {
                    images: containers,
                    pods: podNames
                });
            })
        )
        .mapErrors(({ message = "Unspecified" } = {}) => message)
        .takeErrors(1)
        .toPromise();
};

const reportFormatters = {
    "json": (columns, rawReport)=> rawReport.map((row)=> _.pick(row, columns)),
    "table": (function(){
            const timeConverter = (function(){
                const
                    MIL_IN_SEC = 1000,
                    MIL_IN_MIN = 60 * MIL_IN_SEC,
                    MIL_IN_HOUR = 60 * MIL_IN_MIN,
                    MIL_IN_DAY = 24 * MIL_IN_HOUR,
                    factors = [MIL_IN_DAY, MIL_IN_HOUR, MIL_IN_MIN, MIL_IN_SEC],
                    captions = ["d", "h", "m", "s"];

                return (span)=>factors.map((function(ac){
                    return (factor, index)=> {
                        let section = [_.padStart(~~(ac / factor), 2, "0"), captions[index]].join('');
                        ac = ac % factor;
                        return section;
                    }
                })(span)).join(':');
            })();

        const columnsFormats = {
            "name": { caption: "Name" },
            "desired": { caption: "Desired" },
            "current": { caption: "Current" },
            "available":  { caption: "Available" },
            "age": { caption: "Age", formatter: timeConverter },
            "images": { caption: "Images(s)", formatter: (containers)=> containers.map(({image})=> _.truncate(image, { length: 80 })).join('\n') },
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
        { extended: cmdLineArgs["col"].some((selectedColumn)=> ["pods", "images"].includes(selectedColumn)) },
        _.at(cmdLineArgs, ["port", "host", "protocol"]).some(Boolean) && { port, host, protocol }
    ))
    .then(_.partial(reportFormatters[cmdLineArgs["format"]], _.uniq(["name", ...cmdLineArgs["col"]])))
    .then(console.log)
    .catch(console.warn);