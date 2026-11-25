# HiGHS browser solver

Pinned npm package: highs@1.16.0.
Source: https://github.com/lovasoa/highs-js
Package: https://registry.npmjs.org/highs/-/highs-1.16.0.tgz
Tarball integrity: sha512-Xo6becljpv6y1lYKwAOtqv6YDtCKxXWk/84Ik5dnol2BBqNv3T4wShd93a9Tv6vdMoY9Pn8y4zJ5yj3idRrY4g==

The vendored highs.js and highs.wasm are the unmodified package build assets.
The wrapper and embedded HiGHS use the MIT license reproduced in highs.LICENSE.
Both assets are served by this application; no external CDN or remote solver is used.
Initialization is asynchronous inside the planning Worker. Solves are synchronous
inside that Worker and preserve integer session/appointment constraints.
