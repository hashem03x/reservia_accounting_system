'use strict';

const express = require('express');
const authController = require('../controller/user/authController');
const { runNow, updateSchedule, getBackupSettings, getBackupFiles, downloadBackupFile } = require('./backup.controller');

const router = express.Router();

router.use(authController.protect);
router.use(authController.allowedTo('admin'));

/**
 * @route   POST /admin/backup/run
 * @desc    Trigger an immediate backup
 * @access  Admin
 */
router.post('/run', runNow);

/**
 * @route   POST /admin/backup/schedule
 * @desc    Update daily schedule time  { "time": "HH:mm" }
 * @access  Admin
 */
router.post('/schedule', updateSchedule);

/**
 * @route   GET /admin/backup/settings
 * @desc    Get current backup settings
 * @access  Admin
 */
router.get('/settings', getBackupSettings);

/**
 * @route   GET /admin/backup/files/:filename
 * @desc    Download a specific backup archive by name
 * @access  Admin
 * @example GET /api/v1/admin/backup/files/data-export-2026-05-12_07-32-00.tar.gz
 */
router.get('/files/:filename', downloadBackupFile);

/**
 * @route   GET /admin/backup/files
 * @desc    List all stored backup archives
 * @access  Admin
 */
router.get('/files', getBackupFiles);

module.exports = router;
