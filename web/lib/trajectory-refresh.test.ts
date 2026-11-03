import {test} from "node:test";
import assert from "node:assert/strict";
import {shouldRefreshTrajectory,trajectoryWindowDue} from "./trajectory-refresh.ts";
test("pending work does not bypass the ordinary expired-path interval", () => {
  assert.equal(shouldRefreshTrajectory(true, false, false, 16, 16), true);
  assert.equal(shouldRefreshTrajectory(false, true, false, 16, 16), false);
  assert.equal(shouldRefreshTrajectory(false, true, false, 49, 49), false);
  assert.equal(shouldRefreshTrajectory(false, true, false, 50, 50), true);
  assert.equal(shouldRefreshTrajectory(false, false, false, 200, 200), false);
});
test("selected refresh follows its own interval despite ordinary or pending updates", () => {
  assert.equal(shouldRefreshTrajectory(false, true, true, 200, 99), false);
  assert.equal(shouldRefreshTrajectory(false, true, true, 10, 100), true);
});


test("every expired spacecraft is admitted immediately, independent of global orbit cadence",()=>{
  for(let object=0;object<83;object++) {
    assert.equal(shouldRefreshTrajectory(false,true,false,0,0,true),true);
    assert.equal(shouldRefreshTrajectory(false,true,true,0,0,true),true);
  }
  assert.equal(shouldRefreshTrajectory(false,false,false,1000,1000,true),false);
});


test("scientific jobs prefetch before forward or reverse coverage expiry",()=>{
  assert.equal(trajectoryWindowDue([-312,312],200,3600,true,1/30),true);
  assert.equal(trajectoryWindowDue([-312,312],-200,-3600,true,1/30),true);
  assert.equal(trajectoryWindowDue([-312,312],0,3600,true,1/30),false);
  assert.equal(trajectoryWindowDue([-312,312],200,3600,false,1/30),false);
});

test("measured end-to-end work lead starts refresh early in both directions without altering pause compatibility",()=>{
 assert.equal(trajectoryWindowDue([-250,1750],300,36000,true,1/30),false);
 assert.equal(trajectoryWindowDue([-250,1750],300,36000,true,1/30,2),true);
 assert.equal(trajectoryWindowDue([-1750,250],-300,-36000,true,1/30,2),true);
 assert.equal(trajectoryWindowDue([-250,1750],-200,36000,true,1/30,2),false,'lead is capped to 75 percent of the real valid window');
 assert.equal(trajectoryWindowDue([-250,1750],300,36000,false,1/30,2),false);
 assert.equal(trajectoryWindowDue([-250,1750],300,0,true,1/30,2),false);
});
