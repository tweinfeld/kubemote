
'use strict';
const kefir = require('kefir');
const _ = require('lodash');
var argv = require('minimist')(process.argv.slice(2));

kefir.fromPromise(new Promise((yes , no)=>{
  yes([1,2,3]);
})).map().filter(x=>true || x<5).log();

 kefir.combine([1 ,2 ,4].map((e)=>{
   return kefir.constant({a:'a'+e})
 })).flatten().log();

 function* genFuncWithReturn() {
     yield console.log('a');
     yield console.log('b');
     return 'result';
 }
genFuncWithReturn();
setTimeout(genFuncWithReturn, 1000);
