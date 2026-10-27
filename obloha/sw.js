// Service worker ranného oznámenia pre Živú oblohu - ten istý ako v koreni (sw.js), len
// zaregistrovaný s rozsahom obloha/. Android oznámenie pripíše nainštalovanej appke, len keď
// rozsah service workera leží v jej rozsahu: s koreňovým by ho podpísal Chrome (jeho logo vľavo).
// Mimo tsc z rovnakého dôvodu ako sw.js.

import '../sw.js';
