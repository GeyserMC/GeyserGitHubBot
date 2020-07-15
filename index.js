// const { Docker } = require('node-docker-api')
const https = require('https')
const fs = require('fs')

// const docker = new Docker({ socketPath: '/var/run/docker.sock' })

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
  app.log('Loaded!')

  app.on('issue_comment.created', async context => {
    const issue = context.payload.issue
    const comment = context.payload.comment
    const repoOwner = context.payload.repository.owner.login
    const repoName = context.payload.repository.name

    // Check if the user is a collaborator
    let collaborator = false
    try {
      collaborator = ((await context.github.repos.checkCollaborator({ owner: repoOwner, repo: repoName, username: comment.user.login })).status === 204)
    } catch (ignored) { }

    if (comment.body.trim() === '!start-test-server' && collaborator) {
      const initialComment = context.issue({ body: `Preparing and starting test server as requested by @${comment.user.login} at ${getNiceDate()}` })
      let { data: issueComment } = await context.github.issues.createComment(initialComment)

      // const { data: pull } = await context.github.pulls.get({ owner: repoOwner, repo: repoName, pull_number: issue.number })

      const { data: workflows } = await context.github.actions.listRepoWorkflowRuns({ owner: repoOwner, repo: repoName })
      let artifacts = null

      for (const workflow of workflows.workflow_runs) {
        if (workflow.pull_requests[0].number === issue.number) {
          artifacts = (await context.github.actions.listWorkflowRunArtifacts({ owner: repoOwner, repo: repoName, run_id: workflow.id })).data
          break
        }
      }

      if (artifacts == null) {
        appendComment(context, repoOwner, repoName, issueComment, `\n\nNo artifacts found for PR #${issue.number}, its likely the build hasnt finished!`)
        return
      }

      let artifactID = 0

      for (const artifact of artifacts.artifacts) {
        if (artifact.name === 'Geyser Standalone') {
          artifactID = artifact.id
        }
      }

      if (artifactID === 0) {
        appendComment(context, repoOwner, repoName, issueComment, '\n\nFound artifacts but no Standalone build was included!')
        return
      }

      issueComment = await appendComment(context, repoOwner, repoName, issueComment, '\n\nDownloading Geyser Standalone...')

      let artifactURL = ''
      try {
        artifactURL = (await context.github.actions.downloadArtifact({ owner: repoOwner, repo: repoName, artifact_id: artifactID, archive_format: 'zip' })).url
      } catch (ignored) { }

      const fileName = `PR#${issue.number}.zip`
      const file = fs.createWriteStream(fileName)
      https.get(artifactURL, (response) => {
        if (response.statusCode === 200) {
          response.pipe(file)
        } else {
          appendComment(context, repoOwner, repoName, issueComment, `\n\nUnable to download artifact, got response: ${response.statusCode} - ${response.statusMessage}`)
          return
        }

        file.on('finish', () => {
          file.close(() => startTestingDocker(app, context, issueComment, fileName))
        })
      }).on('error', (e) => {
        appendComment(context, repoOwner, repoName, issueComment, `\n\nUnable to download artifact: ${e.message}`)
      })
    }
  })
}

async function appendComment (context, repoOwner, repoName, comment, appendText) {
  return (await context.github.issues.updateComment({ owner: repoOwner, repo: repoName, comment_id: comment.id, body: comment.body + appendText })).data
}

function getNiceDate () {
  return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '') + ' UTC'
}

async function startTestingDocker (app, context, issueComment, fileName) {
  const issue = context.payload.issue
  const repoOwner = context.payload.repository.owner.login
  const repoName = context.payload.repository.name

  issueComment = await appendComment(context, repoOwner, repoName, issueComment, '\n\nFinished download, setting up docker container...')

  app.log('Store PR#, filename, comment id and docker container name in a local db for tracking')
  app.log(`Extract ${fileName}`)
  app.log('Move to tmp dir')
  app.log('Start docker container')
  app.log('Update comment with connection url')
  app.log(`minecraft://?addExternalServer=Test PR%23${issue.number}|(IP):(Port)`)
}
