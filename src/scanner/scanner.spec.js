
'use strict';
 const _ = require('lodash');

 const kefir = require('kefir');
 let a = kefir.constant({name:"oleg"});
 let m = kefir.constant({name1:"moshe"});
 let b = kefir.sequentially(100, [{num:1}, {num:3}]);

 kefir.combine([a, b, m], _.merge).log();
