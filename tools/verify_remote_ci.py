#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
"""Read GitHub Actions through gh; only the exact, fully passing commit can be delivered."""
import argparse
import json
import re
import subprocess
import sys

REQUIRED_STEPS = {
    'core': ['Version and dependency policy', 'Format', 'Check workspace', 'Clippy',
             'Test workspace', 'Build WASM core transport',
             'Generated TS, strict types and Native/WASM interoperability',
             'Production browser Surface and lifecycle integration'],
    'gpu-prototype': ['Draw and read back pixels'],
}


def validate_run(run, sha):
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Expected a full lowercase commit SHA')
    if run.get('event') != 'push':
        raise ValueError('Only push runs test the exact delivery commit; PR merge-tree runs are not accepted')
    if run.get('headSha') != sha or run.get('workflowName') != 'Rust Core CI':
        raise ValueError('CI commit or workflow does not match the delivery candidate')
    if run.get('status') != 'completed' or run.get('conclusion') != 'success':
        raise ValueError('CI has not completed successfully')
    jobs = run.get('jobs', [])
    names = [job.get('name') for job in jobs]
    if len(names) != len(set(names)) or not REQUIRED_STEPS.keys() <= set(names):
        raise ValueError('Missing or ambiguous required CI jobs')
    for job in jobs:
        if job.get('status') != 'completed' or job.get('conclusion') != 'success':
            raise ValueError(f'Job did not pass: {job.get("name")}')
        for required in REQUIRED_STEPS.get(job.get('name'), []):
            matches = [step for step in job.get('steps', []) if step.get('name') == required]
            if len(matches) != 1 or matches[0].get('status') != 'completed' or matches[0].get('conclusion') != 'success':
                raise ValueError(f'Required check missing, skipped or failed: {required}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True, type=int)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--repo', default='spacelibres/spaceeyes')
    args = parser.parse_args()
    try:
        result = subprocess.run(['gh', 'run', 'view', str(args.run_id), '--repo', args.repo,
                                 '--json', 'event,headSha,workflowName,status,conclusion,jobs,url'],
                                capture_output=True, text=True, encoding='utf-8', check=True)
        run = json.loads(result.stdout)
        validate_run(run, args.sha)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f'Remote CI gate rejected delivery: {error}', file=sys.stderr)
        return 1
    print(f'Remote CI gate passed for {args.sha}: {run.get("url")}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
