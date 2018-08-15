require("dotenv").config()

const express = require("express")
const octokit = require("@octokit/rest")({
  timeout: 0,
  headers: {
    accept: "application/vnd.github.v3+json",
    "user-agent": "octokit/rest.js v15.9.4",
    Authorization: "token " + process.env.GH_TOKEN
  }
})
const Parallel = require("async-parallel")

const _ = require("lodash")

const config = {
  filename: "./data.db"
}

// database

var knex = require("knex")({
  client: "sqlite",
  connection: config,
  useNullAsDefault: true
})

const createIfNotExists = (tableName, schema) =>
  knex.schema.hasTable(tableName).then(exists => {
    if (!exists) {
      return knex.schema.createTable(tableName, schema)
    }
  })

createIfNotExists("posts", t => {
  t.increments("id").primary()

  t.string("title", 150)
  t.string("source", 150)

  t.date("date", 150)

  t.text("content")
  t.text("html")
  t.text("meta")
})

console.log("Database configuration :::", config)

const app = express()

// use json encoded bodies
app.use(express.json())
// use CORS
app.use(require("cors")())

// routes

const port = process.env.PORT || 5000

const newline = "\n"

const deserializePost = post => ({ ...post, meta: JSON.parse(post.meta) })

const handleErr = res => err => {
  console.dir(err)
  return res.send({ err })
}

app.post("/post", (req, res) => {
  const { title, content, source, date, meta, html } = req.body.post
  console.log("recieved post for creation")
  console.dir(req.body)

  knex("posts")
    .insert({
      title,
      meta: JSON.stringify(meta),
      content: content ? content.join(newline) : content,
      source,
      date,
      html
    })
    .then(([id]) => res.send({ id, title, content, source, date, meta, html }))
    .catch(handleErr(res))
})

app.put("/post", (req, res, next) => {
  const { id, ...post } = req.body.post
  console.log("updating post", id)
  console.dir(req.body.post)

  knex("posts")
    .where("id", id)
    .update(post)
    .then(rows => res.send({ rows_affected: rows }))
    .catch(handleErr(res))
})

app.get("/post", (req, res, next) => {
  const query = !_.isEmpty(req.query)
    ? req.query
    : !_.isEmpty(req.body)
      ? req.body
      : true

  console.log("searching for posts using following query:")
  console.dir(query)

  knex("posts")
    .where(query)
    .then(posts =>
      res.send({ posts: posts.map(deserializePost), query, newline })
    )
    .catch(handleErr(res))
})

app.delete("/post", (req, res, next) => {
  const query = !_.isEmpty(req.query) ? req.query : req.body

  knex("posts")
    .where("id", query.id)
    .del()
    .then(res.send)
    .catch(handleErr(res))
})

const getContentForParams = async params =>
  await octokit.repos
    .getContent(params)
    .then(response => response.data)
    .then(data =>
      data
        // only include files or directories
        .filter(d => ["file", "dir"].includes(d.type))
        .map(d => ({
          ...d,
          extension: d.name.split(".").pop(),
          params: params
        }))
    )

const getContentRecursively = params =>
  getContentForParams(params)
    .then(
      async data =>
        await Parallel.map(data, async d => {
          switch (d.type) {
            case "file":
              // get the content for this file
              return d
            default:
              // get all the content in this directory
              return await getContentForParams({
                ...params,
                ...d
              })
          }
        })
    )
    // only include markdown and text file responses
    .then(
      async data =>
        await Parallel.filter(data, d => ["md", "txt"].includes(d.extension))
    )

app.get("/github", async (req, res) => {
  const params = req.query

  console.log("fetching posts at the specified github repo:")
  console.dir(params)

  res.send({ data: await getContentRecursively(params), params: params })
})

app.listen(port)

console.log("Listening on port", port)

const fs = require("fs")
const path = require("path")
const os = require("os")

const hostname = `${os.hostname()}:${port}`

app.use((req, res, next) => {
  // if the base URL is not set
  if (!process.env.API_BASE_URL) {
    const base_url = `${req.protocol}://${hostname}`
    fs.appendFile(
      path.resolve(process.cwd(), ".env"),
      "API_BASE_URL=" + base_url + newline,
      err => {
        if (err) throw err
        console.log("Successfully updated the base URL")
      }
    )
    process.env.API_BASE_URL = base_url
  }
  next()
})
