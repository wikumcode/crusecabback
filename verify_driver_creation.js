
async function testCreate() {
    const driverData = {
        name: 'Final Driver',
        email: 'final@driver.com',
        phoneNumber: '1234567890',
        address: '123 Test St',
        licenseNumber: 'LIC-999-VERIFIED',
        expiryDate: '2028-01-01',
        nic: '999888777V'
    };

    try {
        console.log('Sending request to Create Driver...');
        const response = await fetch('http://localhost:5000/api/drivers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(driverData)
        });

        if (response.ok) {
            const data = await response.json();
            console.log('Success! Status:', response.status);
            console.log('Data:', data);
        } else {
            console.error('Failed! Status:', response.status);
            const text = await response.text();
            console.error('Body:', text);
            process.exit(1);
        }

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

testCreate();
