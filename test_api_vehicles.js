const axios = require('axios');

async function testApi() {
    try {
        console.log('Testing GET http://localhost:5000/api/vehicles ...');
        const response = await axios.get('http://localhost:5000/api/vehicles');
        console.log('Status:', response.status);
        console.log('Count:', response.data.length);
        if (response.data.length > 0) {
            console.log('First Vehicle:', JSON.stringify(response.data[0], null, 2));
        } else {
            console.log('No vehicles returned from API');
        }
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testApi();
