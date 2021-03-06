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
                secondsElapsed -= (reduced * multiplier);
                return reduced;
            })
            .map(_.partial(_.padStart, _, 2, "0")).join(':');
    };

let reportStream = kefir
    .fromPromise(remote.getServices())
    .map((serviceList)=> serviceList["items"].map((item)=> _.zipObject(["name", "selector"], _.at(item, ["metadata.name", "spec.selector"]))))
    .flatMap((services)=> {
        return kefir.combine(
            services
                .map(({ name, selector })=> {
                    return kefir
                        .fromPromise(selector ? remote.getPods(selector) : Promise.resolve({ items: [] }))
                        .map((podList) => podList["items"].map((item) => ({
                            name: _.get(item, 'metadata.name'),
                            container: _.get(item, 'status.containerStatuses', []).map((containerItem)=> {
                                return {
                                    "create": new Date(_.get(containerItem, "state.running.startedAt")),
                                    "id": _.last(_.get(containerItem, 'containerID', '').match(/docker:\/\/([a-f0-9]*)/i)),
                                    "active": !!_.get(containerItem, 'state.running'),
                                    "name": _.get(containerItem, 'name'),
                                    "image": _.get(containerItem, 'image')
                                }

                            })
                        })))
                        .map((pods) => ({name, container: _.flatten(_.map(pods, 'container'))}))
                })
        )
    })
    .map((dataSet)=> {
        return dataSet.map(({ name, id, container })=>[
            ` * Service "${highlight(name)}" (${[((count)=> count === 0 ? "No" : count)(container.length), "Containers"].join(' ')})`,
            ...container.map(({ name, id, active, image, create })=> _([
                    " |-->",
                    `[${_.flow(highlight, active ? _.flow(good, _.constant('Up')) : _.flow(bad, _.constant('Down')))()}]`,
                    `Container ${name}`,
                    active && [
                        "<->",
                        highlight(id.substr(0, 12)),
                        "based on",
                        highlight(image),
                        `running for ${readableSince(create)}`
                    ].join(' ')
                ]).compact().join(' ')
            )
        ].join('\n')).join('\n')
    });

reportStream.onValue(console.log);
reportStream.mapErrors(bad).onError(console.error);