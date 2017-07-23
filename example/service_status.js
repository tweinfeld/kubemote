const
    _ = require('lodash'),
    util = require('util'),
    chalk = require('chalk'),
    kefir = require('kefir'),
    Kubemote = require('../src/kubemote');

const
    remote = new Kubemote(),
    [ highlight, good, bad ] = ["bold", "green", "red"].map((name)=> chalk[name]),
    readableSince = (sinceDate)=>{
        let secondsElapsed = ~~((Date.now() - sinceDate.getTime()) / 1000);
        return [60*60, 60, 1]
            .map((multiplier)=> {
                let reduced = ~~(secondsElapsed / multiplier);
                secondsElapsed -= reduced * multiplier;
                return reduced;
            })
            .map(_.partial(_.pad, _, 2, "0")).join(':');
    };

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
            ` * Service "${highlight(name)}" (${[((count)=> count === 0 ? "No" : count)(container.length), "Containers"].join(' ')})`,
            ...container.map(({ name, id, active, image, create })=>` |--> [${active ? good('Up') : bad('Down')}] Container "${name} <-> ${id.substr(0, 12)}" based on ${image}${active ? ` running for ${readableSince(create)}` : ""}`)
        ].join('\n')).join('\n')
    });

reportStream.onValue(console.log);
reportStream.mapErrors(chalk.red).onError(console.error);