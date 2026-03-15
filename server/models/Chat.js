import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const messageSchema = new Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const chatSchema = new Schema(
  {
    title: {
      type: String,
      default: 'New Chat',
    },
    pdfFile: {
      type: String,
      default: null,
    },
    vectorCollection: {
      type: String,
      default: null,
    },
    messages: [messageSchema],
    // Future fields (uncomment when adding features):
    // pdfId:  { type: Schema.Types.ObjectId, ref: 'PDF' },
    // userId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export default model('Chat', chatSchema);
