function onTranslated() {
  // if (!finished || errorCode !== 0) {
  //   return;
  // }
  var s = cr.googleTranslate.sourceLang();
  console.log(`Translated: ${s}`);
}
function callTranslate(targetLang, sourceLang = "") {
  if (!cr?.googleTranslate?.libReady) {
    throw new Error("Translation library not loaded: ", cr.googleTranslate.errorCode);
  }
  // cr.googleTranslate.setresultCallback(onTranslated);
  console.log(cr.googleTranslate.translate("auto", targetLang));
}
