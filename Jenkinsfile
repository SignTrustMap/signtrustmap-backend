pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
    timeout(time: 20, unit: 'MINUTES')
  }

  environment {
    CI = 'true'
    NPM_CONFIG_CACHE = "${WORKSPACE}/.npm-cache"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install') {
      steps {
        sh 'node --version'
        sh 'npm --version'
        sh 'npm ci --no-audit --no-fund'
      }
    }

    stage('Quality') {
      parallel {
        stage('ESLint') {
          steps {
            sh 'npm run lint'
          }
        }

        stage('Jest') {
          steps {
            sh 'npm run test:cov'
          }
        }

        stage('Build') {
          steps {
            sh 'npm run build'
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts(
        artifacts: 'apps/nestjs/coverage/**',
        allowEmptyArchive: true,
        fingerprint: true
      )
    }
  }
}
