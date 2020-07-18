const fs = require('fs')

module.exports = class Utils {
  /**
   * Setup some variables for the class
   *
   * @param {import('node-docker-api').Docker} docker The docker instance
   * @param {String} prFolder The folder containing the PRs
   */
  static setup (docker, prFolder) {
    this.docker = docker
    this.prFolder = prFolder
  }

  /**
   * Append the given text onto the end of the given comment
   *
   * @param {import('probot').Context} context The webhook context
   * @param {String} repoOwner The user/org that owns the repo
   * @param {String} repoName The name of the repo
   * @param {import('probot').Octokit.IssuesCreateCommentResponse} comment The existing comment
   * @param {String} appendText The message to append
   *
   * @returns {import('probot').Octokit.IssuesCreateCommentResponse} The new comment
   */
  static async appendComment (context, repoOwner, repoName, comment, appendText) {
    return (await context.github.issues.updateComment({ owner: repoOwner, repo: repoName, comment_id: comment.id, body: comment.body + appendText })).data
  }

  /**
   * Get a nicely formatted date
   *
   * @returns {String} A date string in the format YYYY-MM-DD HH:MM:SS UTC
   */
  static getNiceDate () {
    return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '') + ' UTC'
  }

  /**
   * Remove a container and call the callback functions as needed
   *
   * @param {String} containerName The name of the container to remove
   * @param {Function} callback The callback function
   * @param {Function} errorCallback The error callback function
   */
  static removeContainer (containerName, callback, errorCallback) {
    const existingContainer = this.docker.container.get(containerName)
    existingContainer.stop({ t: 10 })
      .then(() => {
        if (callback !== undefined) {
          callback()
        }
      })
      .catch((error) => {
        if (errorCallback !== undefined) {
          errorCallback(error)
        }
      })
  }

  /**
   * Remove the container folder if it exists
   *
   * @param {String} prNumber The PR to remove the container of
   */
  static removeContainerFolder (prNumber) {
    const individualPRFolder = `${this.prFolder}/${prNumber}`

    if (fs.existsSync(individualPRFolder)) {
      fs.rmdirSync(individualPRFolder, { recursive: true })
    }
  }
}
