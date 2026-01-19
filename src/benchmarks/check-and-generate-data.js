import Models from "../models/index.js";
import "../services/mongoose.js";

await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for DB connection
const userCount = await Models.User.countDocuments();
const appCount = await Models.App.countDocuments();
const policyCount = await Models.PrivacyPolicy.countDocuments();

console.log("Users:", userCount);
console.log("Apps:", appCount);
console.log("Policies:", policyCount);

if (userCount === 0 || appCount === 0 || policyCount === 0) {
  console.log("Need to generate test data");
  process.exit(1);
}
process.exit(0);
