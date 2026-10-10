# MAD Studio app – third-party components

The app's user interface (the JavaScript in `assets/`) contains the following packages. The native
engine lists its own components in `engine/licenses/THIRD-PARTY-NOTICES.md` (shipped next to it).

| Package | Version | Licence | Copyright |
| ------- | ------- | ------- | --------- |
| React, React DOM, Scheduler | 19.3.0 / 19.3.0 / 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| Zustand | 5.0.15 | MIT | Copyright (c) 2019 Paul Henschel |
| Immer | 11.1.21 | MIT | Copyright (c) 2017 Michel Weststrate |
| fflate | 0.8.3 | MIT | Copyright (c) 2026 Arjun Barrett |
| @breezystack/lamejs (JavaScript port of LAME, MP3 export) | 1.2.7 | LGPL-3.0 | The LAME project (https://lame.sourceforge.io) and the lamejs authors |

## LAME (MP3 encoder)

MP3 export uses LAME through lamejs, unmodified, under the GNU Lesser General Public License
version 3 (`LGPL-3.0.txt`, which adds permissions to the GNU GPL version 3 in `GPL-3.0.txt`). The
encoder is a separate file in the app (`assets/lamejs-*.js`) that is loaded only when an MP3 is
exported; it can be replaced by another build of the same package version. Its source is the npm
package `@breezystack/lamejs@1.2.7` (https://www.npmjs.com/package/@breezystack/lamejs, a fork of
https://github.com/zhuker/lamejs). More about LAME: https://lame.sourceforge.io.

## MIT licence (React, React DOM, Scheduler, Zustand, Immer, fflate)

Each package is used under the MIT licence with the copyright line from the table above:

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
