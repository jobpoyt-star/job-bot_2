'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('raw job persistence excludes non-India and ambiguous jobs', async () => {
  const supabaseClientPath = require.resolve('../src/database/supabaseClient');
  const jobRepositoryPath = require.resolve('../src/database/jobRepository');
  delete require.cache[jobRepositoryPath];

  const supabaseStub = {
    from(table) {
      if (table === 'information_schema.columns') {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'companies') {
        return {
          select() {
            return {
              ilike() {
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: { id: 'freshworks-company' }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      assert.fail(`Unexpected database access: ${table}`);
    },
  };

  require.cache[supabaseClientPath] = {
    id: supabaseClientPath,
    filename: supabaseClientPath,
    loaded: true,
    exports: supabaseStub,
  };

  try {
    const { prepareJobsForInsert } = require('../src/database/jobRepository');
    const preparedJobs = await prepareJobsForInsert([
      {
        title: 'India role',
        company: 'Freshworks',
        location: 'Bengaluru',
        country: 'in',
        apply_url: 'https://jobs.smartrecruiters.com/Freshworks/india',
      },
      {
        title: 'US role',
        company: 'Freshworks',
        location: 'Austin, United States',
        country: 'us',
        apply_url: 'https://jobs.smartrecruiters.com/Freshworks/us',
      },
      {
        title: 'Unknown location role',
        company: 'Freshworks',
        apply_url: 'https://jobs.smartrecruiters.com/Freshworks/unknown',
      },
    ]);

    assert.equal(preparedJobs.length, 1);
    assert.equal(preparedJobs[0].title, 'India role');
    assert.equal(preparedJobs[0].location, 'Bengaluru, India');
  } finally {
    delete require.cache[jobRepositoryPath];
    delete require.cache[supabaseClientPath];
  }
});
