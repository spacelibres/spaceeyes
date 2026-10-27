#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
"""The delivery gate must reject stale, missing, pending, failed or skipped checks."""
import copy
import unittest
from verify_remote_ci import REQUIRED_STEPS, validate_run

SHA = 'a' * 40


def successful_run():
    return {
        'headSha': SHA, 'workflowName': 'Rust Core CI', 'event': 'push',
        'status': 'completed', 'conclusion': 'success',
        'jobs': [{'name': name, 'status': 'completed', 'conclusion': 'success',
                  'steps': [{'name': step, 'status': 'completed', 'conclusion': 'success'}
                            for step in steps]} for name, steps in REQUIRED_STEPS.items()],
    }


class RemoteGateTests(unittest.TestCase):
    def test_exact_commit_and_all_required_checks_pass(self):
        validate_run(successful_run(), SHA)

    def test_stale_pending_failed_missing_and_skipped_never_pass(self):
        base = successful_run()
        cases = []
        for key, value in [('headSha', 'b' * 40), ('workflowName', 'Other'),
                           ('event', 'pull_request'), ('event', 'workflow_dispatch'),
                           ('status', 'in_progress'), ('conclusion', 'failure')]:
            case = copy.deepcopy(base)
            case[key] = value
            cases.append(case)
        case = copy.deepcopy(base)
        case['jobs'].pop()
        cases.append(case)
        for conclusion in ['failure', 'skipped', 'cancelled', '']:
            case = copy.deepcopy(base)
            case['jobs'][0]['conclusion'] = conclusion
            cases.append(case)
            case = copy.deepcopy(base)
            case['jobs'][0]['steps'][0]['conclusion'] = conclusion
            cases.append(case)
        case = copy.deepcopy(base)
        case['jobs'][0]['steps'].pop()
        cases.append(case)
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                validate_run(case, SHA)


if __name__ == '__main__':
    unittest.main()
