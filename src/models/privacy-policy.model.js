import mongoose from "mongoose";
const Schema = mongoose.Schema;
import findOrCreate from "mongoose-findorcreate";

var schema = new Schema(
  {
    version: {
      type: String,
      default: () => Date.now().toString(),
      description: "Policy version for cache invalidation on policy updates",
    },
    attributes: [
      {
        name: String,
        left: Number,
        right: Number,
      },
    ],
    purposes: [{ name: String, left: Number, right: Number }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);
schema.plugin(findOrCreate);

export default mongoose.model("privacyPolicy", schema);
