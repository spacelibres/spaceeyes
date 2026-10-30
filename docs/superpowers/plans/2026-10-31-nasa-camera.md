# NASA Camera Operations Implementation Plan

> Execute with subagent-driven-development; user authorized continuous implementation. Source docs/NASA-Eyes相机操作闭环设计.md.

Goal: distinct Nearby/System/Follow + shared controlled camera input + scene context surfaces/layers. Bevy0.19.1 WASM, TS SDK/Next; current branch only.

Shared contracts:
- SDK camera.observe(targetId,mode:'nearby'|'system'|'follow',options?:{members?:readonly string[],followId?:string}), camera.orbit(yawRadians,pitchRadians), camera.zoom(delta).
- Core set_camera_observation(session,plugin,target,mode,members:Vec<String>,follow:Option<String>), camera_orbit(session,plugin,yaw,pitch),camera_zoom(session,plugin,delta); core take_camera_input()->[f32;3] rendererconsumes once.
- WASM camera_observe(session,plugin,json{targetId,mode,members?,followId?}),camera_observation()->JSONstatus, camera_orbit(session,plugin,yaw,pitch),camera_zoom(session,plugin,delta).
- Observe schema:nearby nofollow/members;systemmembersunique<=128includes target;followfollowIdrequired!=target/no members. Knownvalidcurrentobjects, camera.control. Allfieldsstrict. Inputeachyaw/pitchfinite[-.5,.5],zoom[-1,1]; accumulatedboundedandreleaseclears.
- Corefocus resetsnearby;overview clearsobservation;orientationpresets preserve currentobservation. Systemcenterselectedradiusmaxmemberrelativeboundexcludingcraftthroughhostselection. Followanchorselected, lookalongdirectiontoreferencewithoff-axisoffset, finiteyaw/pitchlimits; collisionunchanged.
- Host snapshotobservationMode:'nearby'|'system'|'follow',followId:string; Runtime.observation(mode,followId?):Promise<void>, .orbit(yaw,pitch), .zoom(delta),follow(referenceId?). ChooseNearbydefault, parentsurfaces ondemand; scene grouptoggles majorMoons/spacecraft and activecatalogrelationships.

- [x] Core: newcore/src/camera_intent.rs + lib.rs/wasm.rs/renderer.rs, tests. Exactfields above, ECSinput afterfocuschangedclear issue handled, f64relativebasis, lifecycle.
- [x] SDK: newplatform/camera-contract.ts + plugin-host/core-port/wasm-core-port +tests. Immutablevalidatedintents, noBevyobjects, publicskillbookparent.
- [x] Host/UI: solar-workspace.ts/workspace.tsx/workspace-view.tsx/workspace.css, newtouchgesturehelper/tests. Mode+reference UI, +/-/keyboard/touch, groupedscenevisibility andparentsurface, tests.
- [x] Parent integrate/review/freshfullsuite+GPU/versionsdocscommitpushgh. No agentcommits/globalchecks.
