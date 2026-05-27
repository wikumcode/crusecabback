const axios = require('axios');
require('dotenv').config();

async function testApi() {
    const port = process.env.PORT || 5004;
    const url = `http://localhost:${port}/api/vehicles`;
    console.log(`Calling API: ${url}`);
    try {
        const response = await axios.get(url);
        console.log('Status:', response.status);
        console.log('Data count:', response.data.data ? response.data.data.length : 'N/A');
        console.log('Total pagination:', response.data.pagination ? response.data.pagination.total : 'N/A');
        if (response.data.data && response.data.data.length > 0) {
            console.log('Sample vehicle:', JSON.stringify(response.data.data[0], null, 2));
        }
    } catch (error) {
        console.error('API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

testApi();
