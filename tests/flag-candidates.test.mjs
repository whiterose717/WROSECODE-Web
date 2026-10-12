import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFlagCandidates} from '../server/flag-candidates.mjs';
test('recognized CTF flag patterns are extracted, unique and never verified',()=>{
 assert.deepEqual(extractFlagCandidates('flag{example_123} HTB{abc123} flag{example_123}'),['flag{example_123}','HTB{abc123}']);
 assert.deepEqual(extractFlagCandidates('THM{test_flag} picoCTF{practice_case}'),['THM{test_flag}','picoCTF{practice_case}']);
 assert.deepEqual(extractFlagCandidates('random {braces} not_a_real_flag'),[]);
 assert.equal(extractFlagCandidates('CTF{x_0} CTF{x_1} CTF{x_2}',2).length,2);
});
