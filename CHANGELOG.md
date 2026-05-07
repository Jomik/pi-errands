# Changelog

## [0.3.0](https://github.com/Jomik/pi-errands/compare/v0.2.0...v0.3.0) (2026-05-07)


### ⚠ BREAKING CHANGES

* migrate npm scope to @earendil-works/pi-coding-agent ([#2](https://github.com/Jomik/pi-errands/issues/2))

### Features

* agent awareness and widget ([296c3c6](https://github.com/Jomik/pi-errands/commit/296c3c69ad02584ebb430e514980ecf58efa210d))
* **awareness:** restructure injected text with hierarchy and unified status ([cdd4665](https://github.com/Jomik/pi-errands/commit/cdd466571546351f09375b627e14785f05f69d17))
* domain types, status lifecycle, plan store with locking ([e54b5c8](https://github.com/Jomik/pi-errands/commit/e54b5c8bedf24f788f659db3b75e962a08ad5ef3))
* enforce errand delegation pattern in prompt guidelines and awareness ([e46def5](https://github.com/Jomik/pi-errands/commit/e46def55f62c42edc5ec401e791148cd7fe09367))
* graceful degradation when plans fail to load ([07d010a](https://github.com/Jomik/pi-errands/commit/07d010abfa7394a70ddd091d92b5f69af882ef94))
* **mark_chores:** per-update results, no abort on invalid input ([fe80f68](https://github.com/Jomik/pi-errands/commit/fe80f68f6ad2d3623c0b92e842bc31ff82ac7440))
* migrate npm scope to @earendil-works/pi-coding-agent ([#2](https://github.com/Jomik/pi-errands/issues/2)) ([fafb6f3](https://github.com/Jomik/pi-errands/commit/fafb6f36c0f8d01588fcf258cce5e75f698e220e))
* outcome summary, awareness cap, resolve fix; docs ([a7bbf91](https://github.com/Jomik/pi-errands/commit/a7bbf917ec0687e7b4f660eb3ebba7a84b488fa5))
* per-project storage, live widget updates, add_errands ([ec4ee3d](https://github.com/Jomik/pi-errands/commit/ec4ee3dcbf4e574d861118b5ada29a20688cb095))
* short prefixed IDs, plan schema version, load error reporting ([b221cdc](https://github.com/Jomik/pi-errands/commit/b221cdcbc34a7a757f6ef8fabd1d29364688e6e7))
* tighten tool descriptions and guidelines; unify on "chore" vocabulary ([e5eabc2](https://github.com/Jomik/pi-errands/commit/e5eabc200c3edab68afdf88af50f9d28edbcc52d))
* tools and tracking ([9011e07](https://github.com/Jomik/pi-errands/commit/9011e0736debe59f3b8aa9ba697e9129f7e4a894))
* **widget:** outcome summary for completed plans ([7acf233](https://github.com/Jomik/pi-errands/commit/7acf233de69ed0440002fff6d360c7cbc89bd3b1))


### Bug Fixes

* **/errands clear:** include skipped plans in cleanup ([34a21e1](https://github.com/Jomik/pi-errands/commit/34a21e1ab536278377ba96d4ff64102a6b3af754))
* **add_chores:** return structured error instead of throwing on unknown errand ([80f2de7](https://github.com/Jomik/pi-errands/commit/80f2de7aadb07a344f3f07fdfc9800f98d2a651b))
* **lifecycle:** all-skipped resolves to skipped, propagates to summaries ([a275c34](https://github.com/Jomik/pi-errands/commit/a275c34fffba3db77aff472815b31e1ffb5b8ebb))

## [0.2.0](https://github.com/Jomik/pi-errands/compare/v0.1.0...v0.2.0) (2026-05-06)


### Features

* enforce errand delegation pattern in prompt guidelines and awareness ([e46def5](https://github.com/Jomik/pi-errands/commit/e46def55f62c42edc5ec401e791148cd7fe09367))
