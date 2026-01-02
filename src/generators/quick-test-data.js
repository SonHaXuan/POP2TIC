/**
 * Quick Test Data Generator
 * Generates minimal test data for fog benchmarks
 */

import dotenv from "dotenv";
dotenv.config();
import "../services/mongoose.js";
import Models from "../models/index.js";

async function generateTestData() {
  console.log("Generating test data...\n");

  // Check if policy exists
  let policy = await Models.PrivacyPolicy.findOne();

  if (!policy) {
    console.log("Creating privacy policy...");
    // Create simple privacy policy with nested set model
    // Note: _id will be auto-generated as ObjectIds
    policy = await Models.PrivacyPolicy.create({
      attributes: [
        { name: "Location", left: 1, right: 6 },
        { name: "GPS", left: 2, right: 3 },
        { name: "IP Address", left: 4, right: 5 },
        { name: "Contact", left: 7, right: 10 },
        { name: "Email", left: 8, right: 9 },
      ],
      purposes: [
        { name: "Marketing", left: 1, right: 4 },
        { name: "Advertising", left: 2, right: 3 },
        { name: "Analytics", left: 5, right: 6 },
      ],
    });
    console.log("✓ Privacy policy created");
  }

  // Get the actual ObjectIds from the policy
  const locationAttr = policy.attributes.find((a) => a.name === "Location");
  const gpsAttr = policy.attributes.find((a) => a.name === "GPS");
  const contactAttr = policy.attributes.find((a) => a.name === "Contact");
  const analyticsPurpose = policy.purposes.find((p) => p.name === "Analytics");
  const marketingPurpose = policy.purposes.find((p) => p.name === "Marketing");

  // Create users
  const userCount = await Models.User.countDocuments();
  if (userCount < 10) {
    console.log("Creating users...");
    for (let i = 0; i < 10; i++) {
      await Models.User.create({
        fullName: `Test User ${i}`,
        privacyPreference: {
          attributes: [locationAttr._id],
          exceptions: [],
          denyAttributes: [contactAttr._id],
          allowedPurposes: [analyticsPurpose._id],
          prohibitedPurposes: [marketingPurpose._id],
          denyPurposes: [marketingPurpose._id],
          timeofRetention: 3600,
        },
      });
    }
    console.log("✓ 10 users created");
  }

  // Create apps
  const appCount = await Models.App.countDocuments();
  if (appCount < 10) {
    console.log("Creating apps...");
    for (let i = 0; i < 10; i++) {
      await Models.App.create({
        name: `Test App ${i}`,
        attributes: [gpsAttr._id],
        purposes: [analyticsPurpose._id],
        timeofRetention: 1800,
      });
    }
    console.log("✓ 10 apps created");
  }

  console.log("\n✅ Test data ready\n");

  const users = await Models.User.countDocuments();
  const apps = await Models.App.countDocuments();
  console.log(`Users: ${users}`);
  console.log(`Apps: ${apps}`);
}

generateTestData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
