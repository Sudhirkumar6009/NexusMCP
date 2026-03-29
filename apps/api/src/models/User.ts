import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password?: string;
  name: string;
  avatar?: string;
  googleId?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleAccessTokenExpiresAt?: Date;
  role: "admin" | "operator" | "viewer";
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

interface UserDocumentOutput {
  id?: string;
  _id?: mongoose.Types.ObjectId;
  __v?: number;
  password?: string;
  email: string;
  name: string;
  avatar?: string;
  googleId?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleAccessTokenExpiresAt?: Date;
  role: string;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      select: false, // Don't include password by default in queries
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatar: {
      type: String,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values
    },
    googleAccessToken: {
      type: String,
      select: false,
    },
    googleRefreshToken: {
      type: String,
      select: false,
    },
    googleAccessTokenExpiresAt: {
      type: Date,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "operator", "viewer"],
      default: "viewer",
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// Transform output
userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: function (_doc, ret: UserDocumentOutput) {
    ret.id = ret._id?.toString();
    ret._id = undefined;
    ret.password = undefined;
    ret.googleAccessToken = undefined;
    ret.googleRefreshToken = undefined;
    ret.googleAccessTokenExpiresAt = undefined;
    ret.__v = undefined;
  },
});

export const User = mongoose.model<IUser>("User", userSchema);
