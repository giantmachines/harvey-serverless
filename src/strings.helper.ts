export default {
  summary: (firstName, hours, from, to) => `Almost there! So far, ${firstName} has entered ${hours} hours for the week of ${from} to ${to}.`,
  missingHours: (hours) => `Missing ${hours} hours`,
  withAttachments: (from, to) => `*Almost there!* These team members still have to add hours from yesterday!`,
  withoutAttachments: () => '*Nicely done, folks!* I’ve got no reminders for you, because *everyone has already entered their hours.* Keep it up!'
};