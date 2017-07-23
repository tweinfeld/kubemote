const
    _ = require('lodash'),
    util = require('util'),
    chalk = require('chalk'),
    kefir = require('kefir'),
    Kubemote = require('../src/kubemote');

let remote = new Kubemote();

let reportStream = kefir
    .fromPromise(remote.getServices())
    .flatMap((services)=> {
        return kefir.combine(
            services.map(
                ({ name, selector })=>
                    kefir.fromPromise(selector ? remote.getPods(selector) : Promise.resolve([])).map((pods)=> ({ name, container: _.flatten(_.map(pods, 'container')) }))
            )
        )
    })
    .map((dataSet)=> {
        return dataSet.map(({ name, id, container })=>[
            ` * Service "${chalk.bold(name)}" (${[((count)=> count === 0 ? "No" : count)(container.length), "Containers"].join(' ')})`,
            ...container.map(({ name, id, active })=>` |--> [${active ? chalk.bold.green('Up') : chalk.bold.red('Down')}] Container "${chalk.bold(name)}" (${id.substr(0, 12)})`)
        ].join('\n')).join('\n')
    });

reportStream.onValue(console.log);
reportStream.mapErrors(chalk.red).onError(console.error);