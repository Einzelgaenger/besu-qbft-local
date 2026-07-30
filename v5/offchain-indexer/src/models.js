const mongoose = require("mongoose");
const { Schema } = mongoose;

const roomSchema = new Schema({
  clientRequestId: { type: String, index: true },
  txHash: String,
  status: { type: String, enum: ["pending", "confirmed", "failed", "canceled"], required: true },
  roomAddress: String,
  adminAddress: String,
  roomName: String,
  chainId: { type: Number, required: true, index: true },
  createdBlock: Number,
  createdTx: String,
  failReason: String,
}, { timestamps: true });
roomSchema.index({ roomAddress: 1, chainId: 1 }, {
  unique: true,
  partialFilterExpression: { roomAddress: { $type: "string" } },
});

const eventSchema = new Schema({
  chainId: { type: Number, required: true }, roomAddress: String,
  eventName: String, blockNumber: Number, txHash: String, logIndex: Number,
  eventArgs: Schema.Types.Mixed, blockTimestamp: Date,
}, { timestamps: true });
eventSchema.index({ chainId: 1, txHash: 1, logIndex: 1 }, { unique: true });

const syncStateSchema = new Schema({
  key: { type: String, unique: true, required: true },
  lastProcessedBlock: { type: Number, required: true },
}, { timestamps: true });

module.exports = {
  Room: mongoose.model("Room", roomSchema),
  VotingRoomEvent: mongoose.model("VotingRoomEvent", eventSchema),
  SyncState: mongoose.model("SyncState", syncStateSchema),
};
