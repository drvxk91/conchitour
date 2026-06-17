const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on("console", m => { if (!m.text().includes("React DevTools")) console.log("[P]", m.text().substring(0,200)); });
  await page.addInitScript(() => {
    window.conchitect = { openPreview: () => {}, openFile: () => Promise.resolve(null) };
  });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 15000 });
  
  // Step 1: Navigate to Map first
  await page.click('[data-testid="nav-map"]');
  await page.waitForTimeout(500);
  
  // Step 2: Inject 2 scenes using the correct .js URL
  const r = await page.evaluate(async () => {
    const mod = await import("http://localhost:5173/src/store/project.js");
    const store = mod.useProject;
    const s1 = { id:"s1",slug:"scene-a",title:{en:"Scene A"},description:{en:""},altText:{en:""},
      categoryIds:[],geo:{lat:48.8566,lng:2.3522},heading:0,captureHeightMeters:1.6,visibilityRadius:200,
      hotspots:[{id:"h1",type:"link",ath:45,atv:0,targetSceneId:"s2"}],
      media:{sourcePath:"t.jpg",width:4000,height:2000,fileSizeBytes:1000,tilesGenerated:false}};
    const s2 = { id:"s2",slug:"scene-b",title:{en:"Scene B"},description:{en:""},altText:{en:""},
      categoryIds:[],geo:{lat:48.857,lng:2.353},heading:90,captureHeightMeters:1.6,visibilityRadius:200,
      hotspots:[{id:"h2",type:"link",ath:-135,atv:0,targetSceneId:"s1"}],
      media:{sourcePath:"t2.jpg",width:4000,height:2000,fileSizeBytes:1000,tilesGenerated:false}};
    store.getState().addScene(s1);
    store.getState().addScene(s2);
    store.getState().setActiveScene("s1");
    store.getState().setActiveScreen("map");
    await new Promise(r => setTimeout(r, 300));
    return store.getState().project.scenes.length;
  });
  console.log("Scenes injected:", r);
  
  // Step 3: Wait for React re-render
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "C:/Users/matth/AppData/Local/Temp/pw-map-final.png" });
  
  // Check buttons
  const undoBtn  = await page.$('[title="Undo (Ctrl+Z)"]');
  const linkBtn  = await page.$('button:has-text("Link")');
  const autoBtn  = await page.$('[data-testid="auto-compute-btn"]');
  const mapPanel = await page.$('[data-testid="map-panel"]');
  console.log("Undo:", undoBtn?"✅ FOUND":"❌ missing");
  console.log("Link:", linkBtn?"✅ FOUND":"❌ missing");
  console.log("Auto-compute:", autoBtn?"✅ FOUND":"❌ missing");
  console.log("Scene panel:", mapPanel?"✅ FOUND":"❌ missing");
  
  // Test Link mode click
  if (linkBtn) {
    await linkBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "C:/Users/matth/AppData/Local/Temp/pw-link-mode-final.png" });
    const hint = await page.textContent('[data-testid="map-screen"] .text-blue-500, [data-testid="map-screen"] .bg-blue-600\\/90') .catch(() => null);
    console.log("Link mode hint:", hint);
  }
  
  // Test Undo
  if (undoBtn) { await undoBtn.click(); await page.waitForTimeout(300); console.log("Undo clicked OK"); }
  
  // Test Scenes screen hotspot overlay
  await page.evaluate(async () => {
    const mod = await import("http://localhost:5173/src/store/project.js");
    mod.useProject.getState().setActiveScreen("scenes");
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "C:/Users/matth/AppData/Local/Temp/pw-scenes-final.png" });
  
  // Look for hotspot overlay divs (navigate mode - they should be visible on the scene viewer)
  const sceneViewer = await page.$('[data-testid="scene-viewer"]');
  console.log("Scene viewer:", sceneViewer?"✅ FOUND":"❌ missing");
  const hotspotOverlays = await page.$$('.pointer-events-auto.group');
  console.log("Hotspot overlays in navigate mode:", hotspotOverlays.length);
  
  await browser.close();
  console.log("DONE");
})().catch(e => console.error("ERR:", e.message));
