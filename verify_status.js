
const makeRequest = async (method, url, body) => {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
};

async function run() {
    const baseUrl = 'http://localhost:5000/api';

    console.log("Fetching customers...");
    const clients = await makeRequest('GET', `${baseUrl}/clients?status=CONFIRMED`);
    const customer = clients.find(c => c.status === 'CONFIRMED');
    if (!customer) {
        console.error("No confirmed customer found. Cannot proceed.");
        return;
    }
    console.log("Using customer:", customer.id);

    console.log("Fetching existing vehicle for model ID...");
    const vehicles = await makeRequest('GET', `${baseUrl}/vehicles`);
    if (vehicles.length === 0) { console.error("No vehicles to copy model from."); return; }
    const modelId = vehicles[0].modelId;

    console.log("Creating Test Vehicle...");
    const newVehicle = await makeRequest('POST', `${baseUrl}/vehicles`, {
        licensePlate: "TEST-STATUS-" + Date.now(),
        modelId: modelId,
        year: 2024,
        color: "Red",
        fuelType: "Petrol",
        transmission: "Auto",
        status: "AVAILABLE",
        dailyRentalRate: 5000
    });

    if (!newVehicle.id) {
        console.error("Failed to create vehicle", newVehicle);
        return;
    }
    console.log("Created Vehicle:", newVehicle.id, newVehicle.status);

    console.log("Creating Contract...");
    const contract = await makeRequest('POST', `${baseUrl}/contracts`, {
        customerId: customer.id,
        vehicleId: newVehicle.id,
        pickupDate: "2024-02-01",
        pickupTime: "10:00",
        dropoffDate: "2024-02-05",
        dropoffTime: "10:00",
        securityDeposit: 10000,
        fuelLevel: "FULL",
        startOdometer: 1000,
        allocatedKm: 100,
        extraMileageCharge: 100,
        frontTyres: "100%",
        rearTyres: "100%"
    });

    if (!contract.id) {
        console.error("Failed to create contract", contract);
        return;
    }
    console.log("Created Contract:", contract.id, contract.status);

    console.log("Updating to IN_PROGRESS...");
    await makeRequest('PUT', `${baseUrl}/contracts/${contract.id}`, {
        status: "IN_PROGRESS"
    });

    const rentedVehicle = await makeRequest('GET', `${baseUrl}/vehicles/${newVehicle.id}`);
    console.log("Vehicle Status (Should be RENTED):", rentedVehicle.status);
    if (rentedVehicle.status !== 'RENTED') throw new Error("Vehicle status check failed! Expected RENTED");

    console.log("Updating to COMPLETED...");
    await makeRequest('PUT', `${baseUrl}/contracts/${contract.id}`, {
        status: "COMPLETED",
        endOdometer: 1200
    });

    const returnedVehicle = await makeRequest('GET', `${baseUrl}/vehicles/${newVehicle.id}`);
    console.log("Vehicle Status (Should be AVAILABLE):", returnedVehicle.status);
    if (returnedVehicle.status !== 'AVAILABLE') throw new Error("Vehicle status check failed! Expected AVAILABLE");

    console.log("SUCCESS! All checks passed.");

    console.log("Cleaning up...");
    await makeRequest('DELETE', `${baseUrl}/contracts/${contract.id}`);
    await makeRequest('DELETE', `${baseUrl}/vehicles/${newVehicle.id}`);
}

run().catch(console.error);
