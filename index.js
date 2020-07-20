const { Docker } = require('node-docker-api')
const https = require('https')
const path = require('path')
const fs = require('fs')
const ip = require('ip')

const Utils = require('./utils')

const docker = new Docker({ socketPath: '/var/run/docker.sock' })
const prFolder = './pr'
const floodgateKey = './public-key.pem'
const serverIP = ip.address()

Utils.setup(docker, prFolder)

const allowedOwners = ['GeyserMC']

// Create the PR folder
if (!fs.existsSync(prFolder)) {
  fs.mkdirSync(prFolder)
}

// Make sure the floodgate key exists
if (!fs.existsSync(floodgateKey)) {
  console.error('Cannot find the floodgate key!')
  process.exit()
}

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
  app.log('Loaded!')

  // Remove a container (if it exists) when a PR is closed and/or merged
  app.on('pull_request.closed', async context => {
    const repoOwner = context.payload.repository.owner.login

    if (!allowedOwners.includes(repoOwner)) {
      return
    }

    const prNumber = context.payload.number
    const containerName = 'geyser-pr-' + prNumber
    app.log(`PR #${prNumber} closed/merged, removing container if it exists!`)
    Utils.removeContainer(containerName, () => {
      app.log(`Removed container ${containerName}!`)
      Utils.removeContainerFolder(prNumber)
    })
  })

  // Check if a comment is a valid command and parse it
  app.on('issue_comment.created', async context => {
    const issue = context.payload.issue
    const comment = context.payload.comment
    const repoOwner = context.payload.repository.owner.login
    const repoName = context.payload.repository.name

    if (!allowedOwners.includes(repoOwner)) {
      return
    }

    // Check if the user is a collaborator
    let collaborator = false
    try {
      collaborator = ((await context.github.repos.checkCollaborator({ owner: repoOwner, repo: repoName, username: comment.user.login })).status === 204)
    } catch (ignored) { }

    // Check this is a pull request and store for state fetching
    let pull = null
    try {
      pull = (await context.github.pulls.get({ owner: repoOwner, repo: repoName, pull_number: issue.number })).data
    } catch (ignored) { }

    if (collaborator && pull != null && pull.state === 'open') {
      switch (comment.body.trim()) {
        case '!start-test-server':
          runStartCommand(app, context, pull)
          break
        case '!stop-test-server':
          runStopCommand(app, context, pull)
          break

        default:
          break
      }
    }
  })
}

/**
 * Start the build and start process and update the comment along the way
 *
 * @param {import('probot').Application} app The probot app instance
 * @param {import('probot').Context} context The webhook context
 * @param {import('probot').Octokit.PullsGetResponse} pull The pull request
 */
async function runStartCommand (app, context, pull) {
  const issue = context.payload.issue
  const comment = context.payload.comment
  const repoOwner = context.payload.repository.owner.login
  const repoName = context.payload.repository.name

  const initialComment = context.issue({ body: `Preparing and starting test server as requested by @${comment.user.login} at ${Utils.getNiceDate()}` })
  let { data: issueComment } = await context.github.issues.createComment(initialComment)

  const { data: workflows } = await context.github.actions.listRepoWorkflowRuns({ owner: repoOwner, repo: repoName })
  let artifacts = null

  for (const workflow of workflows.workflow_runs) {
    if (workflow.head_sha === pull.head.sha) {
      artifacts = (await context.github.actions.listWorkflowRunArtifacts({ owner: repoOwner, repo: repoName, run_id: workflow.id })).data
      break
    }
  }

  if (artifacts == null) {
    Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nNo artifacts found for PR #${issue.number}, its likely the build hasnt finished!`)
    return
  }

  let artifactID = 0

  for (const artifact of artifacts.artifacts) {
    if (artifact.name === 'Geyser Standalone') {
      artifactID = artifact.id
    }
  }

  if (artifactID === 0) {
    Utils.appendComment(context, repoOwner, repoName, issueComment, '\n\nFound artifacts but no Standalone build was included!')
    return
  }

  issueComment = await Utils.appendComment(context, repoOwner, repoName, issueComment, '\n\nDownloading Geyser Standalone...')

  let artifactURL = ''
  try {
    artifactURL = (await context.github.actions.downloadArtifact({ owner: repoOwner, repo: repoName, artifact_id: artifactID, archive_format: 'zip' })).url
  } catch (ignored) { }

  const individualPRFolder = `${prFolder}/${issue.number}`

  // Remove the individual PR folder if it exists
  Utils.removeContainerFolder(issue.number)

  // Create the individual PR folder and set permissions
  fs.mkdirSync(individualPRFolder)
  fs.chmodSync(individualPRFolder, 0o777)
  fs.linkSync(floodgateKey, path.join(individualPRFolder, floodgateKey))

  const fileName = `${individualPRFolder}/PR#${issue.number}.zip`
  const file = fs.createWriteStream(fileName)
  https.get(artifactURL, (response) => {
    if (response.statusCode === 200) {
      response.pipe(file)
    } else {
      Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nUnable to download artifact, got response: ${response.statusCode} - ${response.statusMessage}`)
      return
    }

    file.on('finish', () => {
      file.close(() => buildTestingDocker(app, context, issueComment, individualPRFolder))
    })
  }).on('error', (e) => {
    Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nUnable to download artifact: ${e.message}`)
  })
}

/**
 * Stop the running docker container if it exists
 *
 * @param {import('probot').Application} app The probot app instance
 * @param {import('probot').Context} context The webhook context
 * @param {import('probot').Octokit.PullsGetResponse} pull The pull request
 */
async function runStopCommand (app, context) {
  const issue = context.payload.issue
  const comment = context.payload.comment
  const repoOwner = context.payload.repository.owner.login
  const repoName = context.payload.repository.name

  const initialComment = context.issue({ body: `Stopping and removing test server as requested by @${comment.user.login} at ${Utils.getNiceDate()}` })
  const { data: issueComment } = await context.github.issues.createComment(initialComment)

  const containerName = 'geyser-pr-' + issue.number
  Utils.removeContainer(containerName, () => {
    Utils.appendComment(context, repoOwner, repoName, issueComment, '\n\nDone.')
    Utils.removeContainerFolder(issue.number)
  }, (error) => {
    Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nUnable to stop and remove test server.\n${error}`)
  })
}

/**
 * Remove the old docker container if it exists and update the comment with the status
 * Then call the next step {@see #startTestingDocker}
 *
 * @param {import('probot').Application} app The probot app instance
 * @param {import('probot').Context} context The webhook context
 * @param {import('probot').Octokit.IssuesCreateCommentResponse} issueComment The existing issue comment
 * @param {String} individualPRFolder The path of the PR folder
 */
async function buildTestingDocker (app, context, issueComment, individualPRFolder) {
  const issue = context.payload.issue
  const repoOwner = context.payload.repository.owner.login
  const repoName = context.payload.repository.name

  const containerName = 'geyser-pr-' + issue.number

  issueComment = await Utils.appendComment(context, repoOwner, repoName, issueComment, '\n\nFinished download, setting up docker container...')

  Utils.removeContainer(containerName, () => {
    startTestingDocker(app, context, issueComment, individualPRFolder)
  }, (error) => {
    app.log('Error on deletion of existing container: ' + error)
    startTestingDocker(app, context, issueComment, individualPRFolder)
  })
}

/**
 * Build and start the docker container and update the comment with the connection details
 *
 * @param {import('probot').Application} app The probot app instance
 * @param {import('probot').Context} context The webhook context
 * @param {import('probot').Octokit.IssuesCreateCommentResponse} issueComment The existing issue comment
 * @param {String} individualPRFolder The path of the PR folder
 */
async function startTestingDocker (app, context, issueComment, individualPRFolder) {
  const issue = context.payload.issue
  const repoOwner = context.payload.repository.owner.login
  const repoName = context.payload.repository.name

  const containerName = 'geyser-pr-' + issue.number

  docker.container.create({
    Image: 'geyser-test',
    name: containerName,
    ExposedPorts: {
      '19132/udp': {}
    },
    HostConfig: {
      Binds: [
        `${path.resolve(individualPRFolder)}:/home/container`
      ],
      PortBindings: {
        '19132/udp': [{ HostPort: '' }]
      },
      AutoRemove: true
    },
    Env: [
      `MOTD="Test PR#${issue.number}"`
    ]
  })
    .then(container => container.start())
    .then(container => container.status())
    .then(status => {
      const port = status.data.NetworkSettings.Ports['19132/udp'][0].HostPort
      Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nBuilt docker container.\n\nConnect via ${serverIP}:${port} (\`minecraft://?addExternalServer=Test%20PR%23${issue.number}|${serverIP}:${port}\`)`)
    })
    .catch(error => Utils.appendComment(context, repoOwner, repoName, issueComment, `\n\nFailed creating and starting docker container.\n${error}`))
}
