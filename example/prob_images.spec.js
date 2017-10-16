const listImages = require('./probe_images').listImages;
describe('prob imagtes test', ()=>{
  it('test single image by name', (done)=>{
    listImages({byName:true, imageName:"verchol/microjob:latest"})
    .takeErrors(1).log().onEnd(done);
  })
  it.skip('test', (done)=>{
    const kefir = require('kefir');

    kefir
    .sequentially(1000, [1000, 1, 2, 3, 4, 5])
    .takeUntilBy(kefir.sequentially(4000, [1]))
    .log()
    .onEnd(done);
  })
})
