const bcrypt = require('bcryptjs');

const hashInDb = '$2b$10$PY9Oj/xh/2J87Ajqb28JPuHZj7NjpTTwLzQjPac/ZrdnhPNtZrOlq';
const passwordToTest = 'SuperAdmin@codebraze';

async function verify() {
    const isMatch = await bcrypt.compare(passwordToTest, hashInDb);
    console.log('Password match:', isMatch);
}

verify();
