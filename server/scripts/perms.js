const db = require('../db');
db.prepare("UPDATE permissions SET actions=? WHERE role_id='dispatcher'").run(JSON.stringify(['map.view', 'search', 'scenarios.run', 'scenarios.save', 'tasks.manage', 'repairs.manage', 'reports.view', 'analytics.view', 'notifications.view', 'editor.edit']));
console.log('dispatcher permissions updated');