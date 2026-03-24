
const makeRequest = async (method, url, body) => {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 400 && res.status !== 201) return res;
    return { status: res.status, data: await res.json() };
};

async function run() {
    const baseUrl = 'http://localhost:5000/api';

    // 1. Setup Vehicles
    console.log("Creating Test Vehicles...");
    const vehicles = await makeRequest('GET', `${baseUrl}/vehicles`);
    const modelId = vehicles.data[0].modelId;

    // V1
    const v1Res = await makeRequest('POST', `${baseUrl}/vehicles`, {
        licensePlate: "V1-EX-TEST-" + Date.now(),
        modelId: modelId,
        year: 2024,
        color: "White",
        fuelType: "Petrol",
        transmission: "Auto",
        status: "AVAILABLE",
        dailyRentalRate: 5000
    });
    const v1Id = v1Res.data.id;

    // V2
    const v2Res = await makeRequest('POST', `${baseUrl}/vehicles`, {
        licensePlate: "V2-EX-TEST-" + Date.now(),
        modelId: modelId,
        year: 2024,
        color: "Black",
        fuelType: "Petrol",
        transmission: "Auto",
        status: "AVAILABLE",
        dailyRentalRate: 5000
    });
    const v2Id = v2Res.data.id;
    console.log("Vehicles Created:", v1Id, v2Id);

    // 2. Create Customer
    const clientRes = await makeRequest('POST', `${baseUrl}/clients`, {
        name: "Test Client Exchange",
        email: "ex-" + Date.now() + "@example.com",
        phone: "1234567890",
        mobile: "0771234567",
        nicOrPassport: "123456789V",
        address: "Test Address",
        status: "CONFIRMED",
        type: "INDIVIDUAL"
    });
    const customerId = clientRes.data.id;

    // 3. Create Contract for V1
    console.log("Creating Contract for V1...");
    const c1Res = await makeRequest('POST', `${baseUrl}/contracts`, {
        customerId,
        vehicleId: v1Id,
        pickupDate: "2024-03-01",
        pickupTime: "10:00",
        dropoffDate: "2024-03-10",
        dropoffTime: "10:00",
        securityDeposit: 10000,
        fuelLevel: "FULL",
        startOdometer: 1000,
        allocatedKm: 100,
        extraMileageCharge: 100,
        frontTyres: "100%",
        rearTyres: "100%"
    });
    const contractId = c1Res.data.id;
    console.log("Contract Created:", contractId);

    // Update to IN_PROGRESS
    await makeRequest('PUT', `${baseUrl}/contracts/${contractId}`, { status: "IN_PROGRESS" });

    // 4. Perform Exchange V1 -> V2
    console.log("Performing Exchange V1 -> V2...");
    const exRes = await makeRequest('POST', `${baseUrl}/contracts/${contractId}/exchange`, {
        oldVehicleId: v1Id,
        newVehicleId: v2Id,
        oldVehicleReturnDate: "2024-03-05",
        oldVehicleReturnOdometer: 1200,
        newVehicleStartDate: "2024-03-05",
        newVehicleStartOdometer: 500,
        newVehicleDailyRate: 6000
    });

    if (exRes.status !== 200 && exRes.status !== 201) {
        console.error("Exchange Failed:", exRes.data);
        throw new Error("Exchange failed");
    }

    // 5. Verify Statuses
    const v1State = (await makeRequest('GET', `${baseUrl}/vehicles/${v1Id}`)).data;
    const v2State = (await makeRequest('GET', `${baseUrl}/vehicles/${v2Id}`)).data;

    console.log(`V1 Status (Should be BREAKDOWN): ${v1State.status}`);
    console.log(`V2 Status (Should be RENTED): ${v2State.status}`);

    if (v1State.status !== 'BREAKDOWN') throw new Error("V1 Status check failed");
    if (v2State.status !== 'RENTED') throw new Error("V2 Status check failed");

    console.log("SUCCESS! Exchange status logic verified.");

    // Cleanup
    await makeRequest('DELETE', `${baseUrl}/contracts/${contractId}`);
    await makeRequest('DELETE', `${baseUrl}/vehicles/${v1Id}`);
    await makeRequest('DELETE', `${baseUrl}/vehicles/${v2Id}`);
}

run().catch(console.error);
