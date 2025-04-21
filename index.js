const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 9000;
const app = express();
const cookieParser = require("cookie-parser");
const corsOptions = {
  origin: ["https://job-seek-a980a.web.app", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true,
  optionalSuccessStatus: 200,
  allowedHeaders: ["Content-Type", "Authorization"],
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zhrby.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
  if (!token) return res.status(401).send({ message: "anthorized access" });
  jwt.verify(token, process.env.SCREAT_KEY, (err, decoded) => {
    if (err) {
      res.status(401).send({ message: "anthorized access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    const db = client.db("solo-db");
    const jobCollection = db.collection("jobs");
    const bidsCollection = db.collection("bids");

    //genarete jwt

    app.post("/jwt", async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res
          .status(400)
          .send({ success: false, message: "Email is required" });
      }
      const token = jwt.sign({ email }, process.env.SCREAT_KEY, {
        expiresIn: "365d",
      });
      // console.log(token);
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    app.post("/add-job", async (req, res) => {
      const jobInfo = req.body;
      const result = await jobCollection.insertOne(jobInfo);
      res.send(result);
    });
    app.put("/update-job/:id", async (req, res) => {
      const updateInfo = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const option = { upsert: true };
      const updateDoc = {
        $set: updateInfo,
      };
      const result = await jobCollection.updateOne(query, updateDoc, option);
      res.send(result);
    });
    app.get("/jobs", async (req, res) => {
      const result = await jobCollection.find().toArray();
      res.send(result);
    });

    app.get("/jobs/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      // console.log("email form params", email);
      // console.log("email form decodedEmail", decodedEmail);
      if (decodedEmail !== email)
        return res.status(401).send({ message: "anthorized access" });
      const query = { "buyer.email": email };
      const result = await jobCollection.find(query).toArray();
      res.send(result);
    });
    app.delete("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobCollection.findOne(query);
      res.send(result);
    });

    app.post("/add-bid", async (req, res) => {
      const bidInfo = req.body;

      //0: check user already apply or not
      const filter = { email: bidInfo.email, jobID: bidInfo.jobID };
      const alreadyExist = await bidsCollection.findOne(filter);
      if (alreadyExist)
        return res.status(400).send("Already Applied on this job!");
      console.log(alreadyExist);

      //1: add to database
      const result = await bidsCollection.insertOne(bidInfo);

      //2: udpate bid count
      const query = { _id: new ObjectId(bidInfo.jobID) };
      const updateData = {
        $inc: { total_bid: 1 },
      };
      const updateBidCount = await jobCollection.updateOne(query, updateData);
      res.send(result);
    });

    app.get("/bids/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      console.log("email form params", email);
      console.log("email form decodedEmail", decodedEmail);

      if (decodedEmail !== email) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const query = { email };
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/bid-request/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      const query = { buyer: email };
      // console.log("email form params", email);
      // console.log("email form decodedEmail", decodedEmail);
      if (decodedEmail !== email)
        return res.status(401).send({ message: "anthorized access" });
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/update-bidStatus/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updated = {
        $set: { status },
      };
      const result = await bidsCollection.updateOne(filter, updated);
      res.send(result);
    });

    app.get("/all-jobs", async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;
      let options = {};
      if (sort) options = { sort: { date: sort === "asc" ? 1 : -1 } };

      let query = {
        job_title: {
          $regex: search,
          $options: "i",
        },
      };
      if (filter) query.category = filter;
      const result = await jobCollection.find(query, options).toArray();
      res.send(result);
    });
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello from SoloSphere Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
