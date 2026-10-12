import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs=[]; p.on('pageerror', e=>errs.push(String(e.message)));
await p.goto('http://127.0.0.1:4173/');
await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const o = {};
  // 所有字母单例
  const all = { m:mO, M:M2O, g:gO, a:aO, v:vO, r:rO, half:halfO, mu:muO,
                c:cO, G:GO, t:tO, B:BO, E:EO, q:qO, I:IO, k:kO, x:xO };
  o.singletonCount = Object.keys(all).length;
  o.dockOrderCount = Object.keys(DOCK_ORDER).length;
  // sortPanel 的 kids 列表里有哪些
  const kids = [mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO];
  o.kidsCount = kids.length;
  o.missingFromKids = Object.entries(all).filter(([k,v]) => !kids.includes(v)).map(([k])=>k);
  // 清屏后再看 k/x 是否回到面板
  o.kBefore = kO.state; o.xBefore = xO.state;
  clearAll();
  o.kAfterClear = kO.state; o.xAfterClear = xO.state;
  sortPanel();
  o.kInPanelAfterSort = kO.el.parentNode === panel;
  o.mInPanelAfterSort = mO.el.parentNode === panel;
  return o;
});
console.log(JSON.stringify(r, null, 2));
console.log('errors:', errs.length?errs.slice(0,2):'(none)');
await b.close();
