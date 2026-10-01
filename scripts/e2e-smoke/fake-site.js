const { FakeJobSite } = require(require('path').resolve(__dirname, '../../backend/dist/__tests__/helpers/fake-job-site'));
const fs = require('fs');
const site = new FakeJobSite();
site.start().then(base => {
  fs.writeFileSync('/tmp/rb-smoke/site-url', base);
  console.log('fake site at', base);
  setInterval(() => fs.writeFileSync('/tmp/rb-smoke/site-submissions', String(site.submissions.length)), 500);
});
