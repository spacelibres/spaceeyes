# NASA Eyes 全局对齐 Implementation Plan

> Required workflow: subagent-driven-development, independent owned paths, task reviews and final integration review. User explicitly authorized autonomous implementation of the existing platform outline on2026-10-31.

Goal: implement the full first-version outline in coherent verified milestones; first close timed satellite tails and related correctness/navigation bugs.
Architecture: Bevy0.19.1 Rust WASM display + controlled TS SDK/data plugin + Next host; external assets. No frozen branch changes. Source design: docs/NASA-Eyes全局对齐审查与执行路线.md.

## Shared first milestone contract

TrajectoryStyle optional kind:'orbit'|'trail' defaultorbit, trailDurationSeconds onlytrail finite1..315576000, breakIndices optional strict ascending indices1..N-1. ExistingoriginId/colorRgba retained. Rust serde andTSstrictvalidation. Emptyclear no stale metadata. Must preserve ownership,4096sessionpointbudget, epochmonotonicity andatomicity.
SolarSystemData.trailSamples(id,epoch,count=256,detailed=false) returns points,epochsTdbSeconds,originId,breakIndices,durationSeconds,refreshRange. Parent-relative history explicitlyrelative; originundefinedICRFabsolute. Noextrapolation/crossphasebridges. Cachedfuture samples permittedbutrendererclips atnow.

- [x] Core task: own core/src/lib.rs,orbit_lines.rs,renderer.rs,wasm.rs + tests. Failingtests→tailclipping/gradient/discontinuities; atomicannotationfix; stylevalidation; rendererline_gradient. Do nottouch otheragents paths/versions.
- [x] Data/SDK task: own platform/solar-system.ts,plugin-host.ts,core-port.ts,wasm-core-port.ts + tests. trailSamplesactualhistory, stylecontract, activefetchcancellation. Coordinatecorewirefields, testspermission/immutability/finite/parentphase/cancellation.
- [x] Host/UI task: own web/lib/solar-workspace.ts,web/app/workspace*.tsx/css + webtests. UseplannedtrailSamplescontract for moons/spacecraft, independentorbit/trails switches, navigationpreservesclock, busyplaybackdisabled. No duplicateclocks/renderers. PreserveVI, labels/inertia/collision/HDR.
- [x] Parent: integrate/review, sourceevidence, manualGPUandrealresources, skillbook/docs/version/CHANGELOG. Runfreshcompletecheck afterlastchange. Commitpushonlyafterpasses; ghstatusnonblocking.
- [ ] Next milestones: independentcameraintent/input; NASA time/navigation shell; representativeassets/attitude/visuals; cache/scientific/perfacceptance. Eachwithconcretedesignandtestsunderuserautonomousauthorization.

First milestone evidence: docs/evidence/nasa-trails-0.0.37/README.md. Remaining global milestones stay open.
